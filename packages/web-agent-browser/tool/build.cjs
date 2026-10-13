const fs = require("node:fs");
const path = require("node:path");
const { compileBrand } = require("./compile-brand.cjs");
const { decodePng, writeIcons } = require("./png-icons.cjs");
const { generateManifest } = require("./manifest.cjs");

/** The toolkit is this script's own package. In this repo that is also the
 *  consumer, so `build(".")` works from the package root. Task 005 publishes
 *  the toolkit and the two become different folders. */
const TOOLKIT_DIR = path.resolve(__dirname, "..");

/** Shipped at the package root, so a consumer install carries it. `src/` is
 *  not published. */
const TEMPLATE_PATH = path.join(TOOLKIT_DIR, "manifest.template.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Builds one brand's `dist/`.
 *
 * NOTHING is written until every validation has passed, so a failed build never
 * leaves a half-branded folder behind.
 *
 * @param {string} consumerDir - the folder holding package.json and brand/
 * @returns {void}
 * @throws {Error} with a single-line message naming the file and the problem
 */
function build(consumerDir) {
  const pkg = readJson(path.join(consumerDir, "package.json"));
  const brandDir = path.join(consumerDir, "brand");
  const brand = compileBrand(brandDir);                       // plugin.yml, model.yml, skills/, hosts
  const icon = decodePng(path.join(brandDir, "icon.png"));    // size, squareness, PNG variant
  const { manifest, truncated } = generateManifest(pkg, brand, readJson(TEMPLATE_PATH));

  // --- every check has passed; only now is anything written ---
  const dist = path.join(consumerDir, "dist");
  fs.rmSync(dist, { recursive: true, force: true });
  fs.cpSync(path.join(TOOLKIT_DIR, "dist-template"), dist, { recursive: true });

  if (Array.isArray(brand.themes) && brand.themes.length > 0) {
    const brandThemesDir = path.join(dist, "brand-themes");
    fs.mkdirSync(brandThemesDir, { recursive: true });
    for (const t of brand.themes) {
      fs.copyFileSync(t.sourcePath, path.join(dist, t.css));
    }
  }

  // Strip the internal build-only sourcePath before brand.json is written.
  const brandToSerialize = {
    ...brand,
    themes: (brand.themes || []).map(({ id, label, scheme, base, css }) => ({ id, label, scheme, base, css })),
  };
  fs.writeFileSync(path.join(dist, "brand.json"), JSON.stringify(brandToSerialize, null, 2));
  writeIcons(icon, path.join(dist, "icons"));
  fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (truncated) {
    console.log(`package.json version "${pkg.version}" has no Chrome equivalent; used "${manifest.version}".`);
  }
  console.log(
    `Built ${manifest.name} ${manifest.version} — `
    + `${brand.models.length} model(s), ${brand.skillDefs.length} skill(s), `
    + `${manifest.host_permissions.length} host permission(s).`,
  );
}

module.exports = { build, TOOLKIT_DIR, TEMPLATE_PATH };

// `node tool/build.cjs [dir]`. The published entry point is
// `bin/web-agent-brand.mjs build`, which calls build() directly.
if (require.main === module) {
  try {
    build(path.resolve(process.argv[2] ?? process.cwd()));
  } catch (e) {
    console.error(e.message);       // one clear line, never a stack trace
    process.exit(1);
  }
}
