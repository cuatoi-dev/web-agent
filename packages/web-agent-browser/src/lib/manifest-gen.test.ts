import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  toChromeVersion,
  isMatchPattern,
  deriveHosts,
  generateManifest,
  FALLBACK_ENDPOINTS,
} = require("../../tool/manifest.cjs") as {
  toChromeVersion: (s: string) => { version: string; truncated: boolean };
  isMatchPattern: (p: string) => boolean;
  deriveHosts: (models: { endpoint: string }[], brandHosts: string[]) => string[];
  generateManifest: (pkg: Record<string, unknown>, brand: Record<string, unknown>, template: Record<string, unknown>) => { manifest: Record<string, unknown>; truncated: boolean };
  FALLBACK_ENDPOINTS: string[];
};

// Import presets to verify drift guard.
import { PRESET_ENTRIES } from "./presets";
import { originPattern } from "./origin";

const TEMPLATE_PATH = path.resolve(__dirname, "../../manifest.template.json");
const template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8")) as Record<string, unknown>;

const BASE_PKG = { name: "acme-agent", displayName: "Acme Assistant", version: "1.4.0", description: "An agent." };
const BASE_BRAND = { models: [], hosts: [] };

describe("toChromeVersion", () => {
  it("plain release is not truncated", () => {
    expect(toChromeVersion("1.4.0")).toEqual({ version: "1.4.0", truncated: false });
  });

  it("pre-release truncates to core and marks truncated", () => {
    expect(toChromeVersion("1.4.0-beta.2")).toEqual({ version: "1.4.0", truncated: true });
  });

  it("build metadata truncates", () => {
    expect(toChromeVersion("1.4.0+build.7")).toEqual({ version: "1.4.0", truncated: true });
  });

  it("five parts keeps only the first four", () => {
    expect(toChromeVersion("1.2.3.4.5").version).toBe("1.2.3.4");
  });

  it("a single integer is valid", () => {
    expect(toChromeVersion("7").version).toBe("7");
  });

  it("non-numeric throws", () => {
    const fn = () => toChromeVersion("not.a.version");
    expect(fn).toThrow(/cannot be a Chrome version/);
    expect(fn).toThrow(/1-4 dot-separated integers, each 0-65535/);
  });

  it("above the 65535 ceiling throws", () => {
    expect(() => toChromeVersion("1.70000.0")).toThrow(/cannot be a Chrome version/);
  });
});

describe("isMatchPattern", () => {
  it("<all_urls> is accepted", () => expect(isMatchPattern("<all_urls>")).toBe(true));
  it("https with wildcard path is accepted", () => expect(isMatchPattern("https://acme.com/*")).toBe(true));
  it("subdomain wildcard is accepted", () => expect(isMatchPattern("*://*.acme.com/*")).toBe(true));
  it("a port is allowed", () => expect(isMatchPattern("http://localhost:10040/*")).toBe(true));
  it("bare host is rejected", () => expect(isMatchPattern("acme.com")).toBe(false));
  it("no path is rejected", () => expect(isMatchPattern("https://acme.com")).toBe(false));
});

describe("deriveHosts", () => {
  it("one endpoint produces its origin", () => {
    expect(deriveHosts([{ endpoint: "https://ai.acme.com/api/anthropic" }], [])).toEqual(["https://ai.acme.com/*"]);
  });

  it("the port is omitted from model endpoints so the pattern matches every port", () => {
    expect(deriveHosts([{ endpoint: "http://localhost:28780/api/anthropic" }], [])).toEqual(["http://localhost/*"]);
  });

  it("three endpoints sharing one origin produces one entry", () => {
    const result = deriveHosts([
      { endpoint: "https://a.com/x" },
      { endpoint: "https://a.com/y" },
      { endpoint: "https://a.com/z" },
    ], []);
    expect(result).toHaveLength(1);
  });

  it("brand hosts are added to the set", () => {
    const result = deriveHosts([{ endpoint: "https://a.com/x" }], ["<all_urls>"]);
    expect(result).toContain("<all_urls>");
    expect(result).toContain("https://a.com/*");
    expect(result).toHaveLength(2);
  });

  it("result is sorted", () => {
    const result = deriveHosts([{ endpoint: "https://z.com/x" }, { endpoint: "https://a.com/x" }], []);
    expect(result).toEqual(["https://a.com/*", "https://z.com/*"]);
  });

  it("a bad pattern throws naming the pattern and a valid example", () => {
    const fn = () => deriveHosts([], ["acme.com"]);
    expect(fn).toThrow(/is not a Chrome match pattern/);
    expect(fn).toThrow(/<all_urls>/);
    expect(fn).toThrow(/https:\/\/acme.com\/\*/);
  });

  it("the fallback endpoint's host matches PRESET_ENTRIES (drift guard)", () => {
    const fallbackHost = new URL(FALLBACK_ENDPOINTS[0]).host;
    const presetHost = new URL(PRESET_ENTRIES[0].endpoint).host;
    expect(fallbackHost).toBe(presetHost);
  });

  it("no models uses the preset fallback endpoint origin", () => {
    const result = deriveHosts([], []);
    expect(result).toEqual(["http://localhost/*"]);
  });

  it("derived host_permissions entry and originPattern produce the same pattern for the same endpoint", () => {
    const endpoint = "http://localhost:28780/api/anthropic";
    const [derived] = deriveHosts([{ endpoint }], []);
    expect(derived).toBe(originPattern(endpoint));
  });

  it("brand hosts preserve explicit ports while model endpoints are portless", () => {
    const result = deriveHosts(
      [{ endpoint: "http://localhost:28780/api/anthropic" }],
      ["http://localhost:10040/*"],
    );
    expect(result).toEqual([
      "http://localhost/*",
      "http://localhost:10040/*",
    ]);
  });
});


describe("generateManifest", () => {
  it("displayName wins over name", () => {
    const { manifest } = generateManifest(BASE_PKG, BASE_BRAND, template);
    expect(manifest.name).toBe("Acme Assistant");
  });

  it("name is the fallback when displayName is absent", () => {
    const pkg = { name: "acme-agent", version: "1.4.0", description: "d" };
    const { manifest } = generateManifest(pkg, BASE_BRAND, template);
    expect(manifest.name).toBe("acme-agent");
  });

  it("description is carried from package.json", () => {
    const { manifest } = generateManifest(BASE_PKG, BASE_BRAND, template);
    expect(manifest.description).toBe("An agent.");
  });

  it("action.default_icon has the two small sizes and default_title is the name", () => {
    const { manifest } = generateManifest(BASE_PKG, BASE_BRAND, template);
    const action = manifest.action as Record<string, unknown>;
    expect(action.default_title).toBe("Acme Assistant");
  });

  it("missing version throws", () => {
    expect(() => generateManifest({ name: "a", description: "d" }, BASE_BRAND, template))
      .toThrow("package.json needs a version");
  });

  it("missing description throws", () => {
    expect(() => generateManifest({ name: "a", version: "1.0.0" }, BASE_BRAND, template))
      .toThrow(/needs a description; it is the extension's store description/);
  });

  it("optional_host_permissions is untouched by the generator", () => {
    const { manifest } = generateManifest(BASE_PKG, BASE_BRAND, template);
    expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
  });

  it("the template object is not mutated across two calls", () => {
    const templateCopy = JSON.parse(JSON.stringify(template)) as Record<string, unknown>;
    const pkg1 = { name: "first", version: "1.0.0", description: "first desc" };
    const pkg2 = { name: "second", version: "2.0.0", description: "second desc" };
    generateManifest(pkg1, BASE_BRAND, template);
    generateManifest(pkg2, BASE_BRAND, template);
    expect(template.name).toBe(templateCopy.name);
  });

  it("every passthrough key is copied unchanged from the template", () => {
    const { manifest } = generateManifest(BASE_PKG, BASE_BRAND, template);
    for (const k of ["manifest_version", "permissions", "background", "content_scripts", "web_accessible_resources", "side_panel", "options_page"] as const) {
      expect(manifest[k]).toEqual(template[k]);
    }
  });

  it("brand themes are appended to the css content script and added to web-accessible resources", () => {
    const brand = {
      models: [],
      hosts: [],
      themes: [{ id: "acme-dense", css: "brand-themes/acme-dense.css" }],
    };
    const { manifest } = generateManifest(BASE_PKG, brand, template);
    const cssScript = (manifest.content_scripts as { css?: string[] }[]).find((cs) => Array.isArray(cs.css));
    expect(cssScript?.css).toEqual(["public-sans.css", "wa-tokens.css", "brand-themes/acme-dense.css"]);
    const war = (manifest.web_accessible_resources as { resources: string[]; matches: string[] }[])
      .find((r) => r.matches.includes("<all_urls>"));
    expect(war?.resources).toContain("brand-themes/*.css");
  });

  it("an empty themes list leaves the content script and resources unchanged", () => {
    const brand = { models: [], hosts: [], themes: [] };
    const { manifest } = generateManifest(BASE_PKG, brand, template);
    expect(manifest.content_scripts).toEqual(template.content_scripts);
    expect(manifest.web_accessible_resources).toEqual(template.web_accessible_resources);
  });
});
