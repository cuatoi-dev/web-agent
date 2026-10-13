/** Every preset endpoint shares one origin, so one entry covers the fallback.
 *  Mirrors GATEWAY_BASE in src/lib/constants.ts:105 — src/ is TypeScript and a
 *  CommonJS build script cannot import it. The drift is pinned by
 *  src/lib/manifest-gen.test.ts "the fallback endpoint's host matches PRESET_ENTRIES (drift guard)". */
const FALLBACK_ENDPOINTS = ["http://localhost:28780/api/anthropic"];

/** <all_urls>, or scheme://host/path. The host segment may carry a port —
 *  Chrome's match-pattern grammar is <scheme>://<host>:<port>/<path> and the
 *  port is optional (verified against developer.chrome.com, 2026-09-12). */
function isMatchPattern(p) {
  if (p === "<all_urls>") return true;
  return /^(\*|https?|file|ftp):\/\/(\*|(\*\.)?[^/*]+)\/.*$/.test(p);
}

/**
 * The install-time origin list: every model endpoint's origin, plus everything
 * the brand asked for.
 *
 * @param {{endpoint: string}[]} models - the brand's models, or [] for none
 * @param {string[]} brandHosts - plugin.yml `hosts`
 * @returns {string[]} sorted, de-duplicated match patterns
 * @throws {Error} naming plugin.yml and the offending pattern
 */
function deriveHosts(models, brandHosts) {
  const hosts = new Set();
  const endpoints = models.length > 0 ? models.map((m) => m.endpoint) : FALLBACK_ENDPOINTS;
  for (const endpoint of endpoints) {
    // Already validated as an absolute http(s) URL by compileModels.
    const u = new URL(endpoint);
    hosts.add(`${u.protocol}//${u.hostname}/*`); // portless: matches every port and agrees with runtime originPattern()
  }
  for (const p of brandHosts) {
    if (!isMatchPattern(p)) {
      throw new Error(
        `plugin.yml hosts '${p}' is not a Chrome match pattern; `
        + "expected <all_urls> or scheme://host/path, e.g. https://acme.com/*",
      );
    }
    hosts.add(p);
  }
  return [...hosts].sort();
}

/**
 * An npm version as a Chrome manifest version.
 *
 * Chrome accepts 1-4 dot-separated integers, 0-65535, and has no field for a
 * pre-release tag — so `1.4.0-beta.2` truncates to `1.4.0` rather than failing.
 * npm pre-releases are normal; the caller prints one line when this happens.
 *
 * @param {string} semver
 * @returns {{version: string, truncated: boolean}}
 * @throws {Error} naming the version and what Chrome accepts
 */
function toChromeVersion(semver) {
  const core = String(semver).split(/[-+]/)[0];
  const parts = core.split(".");
  const ok = parts.length > 0
    && parts.every((p) => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 65535);
  if (!ok) {
    throw new Error(
      `package.json version '${semver}' cannot be a Chrome version; `
      + "use 1-4 dot-separated integers, each 0-65535",
    );
  }
  return { version: parts.slice(0, 4).join("."), truncated: core !== String(semver) };
}

/**
 * The generated manifest. Six keys come from package.json and the brand;
 * everything else is the template, unchanged.
 *
 * @param {object} pkg - the consumer's package.json
 * @param {object} brand - the compiled brand (models, hosts, …)
 * @param {object} template - manifest.template.json, at the package root
 * @returns {{manifest: object, truncated: boolean}}
 * @throws {Error} naming package.json and the missing field
 */
function generateManifest(pkg, brand, template) {
  if (!pkg.version) throw new Error("package.json needs a version");
  if (!pkg.description) {
    throw new Error("package.json needs a description; it is the extension's store description");
  }
  const { version, truncated } = toChromeVersion(pkg.version);

  const m = structuredClone(template);
  m.name = pkg.displayName ?? pkg.name;
  m.version = version;
  m.description = pkg.description;
  m.icons = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" };
  m.action = { ...m.action, default_icon: { 16: "icons/16.png", 32: "icons/32.png" }, default_title: m.name };
  m.host_permissions = deriveHosts(brand.models ?? [], brand.hosts ?? []);

  if (Array.isArray(brand.themes) && brand.themes.length > 0) {
    const cssContentScript = m.content_scripts?.find((cs) => Array.isArray(cs.css));
    if (cssContentScript) {
      for (const t of brand.themes) {
        cssContentScript.css.push(t.css);
      }
    }
    const war = m.web_accessible_resources?.find((r) => r.matches?.includes("<all_urls>"));
    if (war) {
      war.resources.push("brand-themes/*.css");
    } else {
      m.web_accessible_resources = m.web_accessible_resources || [];
      m.web_accessible_resources.push({
        resources: ["brand-themes/*.css"],
        matches: ["<all_urls>"],
      });
    }
  }

  return { manifest: m, truncated };
}

module.exports = { generateManifest, toChromeVersion, deriveHosts, isMatchPattern, FALLBACK_ENDPOINTS };
