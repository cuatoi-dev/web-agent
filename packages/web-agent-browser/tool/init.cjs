const fs = require("node:fs");
const path = require("node:path");

/** The toolkit is this module's own package: tool/ -> package root. */
const TOOLKIT_DIR = path.resolve(__dirname, "..");

/**
 * "acme-agent" -> "Acme Agent". Hyphen and underscore are word separators.
 * This is only the starting displayName; the owner edits it.
 *
 * @param {string} name
 * @returns {string}
 */
function titleCase(name) {
  return name
    .split(/[-_]+/)
    .filter((word) => word !== "")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** The toolkit's own version, read at run time so a scaffold never pins a
 *  version that does not exist. */
function toolkitVersion() {
  const pkg = path.join(TOOLKIT_DIR, "package.json");
  return JSON.parse(fs.readFileSync(pkg, "utf8")).version;
}

/**
 * Scaffolds a new brand package in `targetDir`.
 *
 * NOTHING is written unless the target is free, so a refused init never leaves
 * a half-made package behind.
 *
 * @param {string} targetDir - absolute path; its basename becomes the npm name
 * @returns {{name: string, version: string, dir: string}}
 * @throws {Error} with a single-line message naming the directory
 */
function init(targetDir) {
  if (fs.existsSync(targetDir)) {
    // A plain file counts as occupied too: it is neither empty nor a directory
    // we may write into, and the owner needs the same one-line answer.
    const occupied = !fs.statSync(targetDir).isDirectory()
      || fs.readdirSync(targetDir).length > 0;
    if (occupied) {
      throw new Error(`${targetDir} already exists and is not empty`);
    }
  }

  const name = path.basename(targetDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const pkg = {
    name,
    displayName: titleCase(name),
    version: "0.1.0",
    description: `A web agent for ${name}.`,
    // They opt IN to publishing by removing this. A scaffolder that leaves a
    // package publish-ready invites a publish under a name nobody chose yet.
    private: true,
    scripts: { build: "web-agent-brand build" },
    dependencies: { "@cuatoi/web-agent-browser": `^${toolkitVersion()}` },
    // The consumer package is published WITH its dist/, so colleagues can
    // install and load it. The brand sources stay out of the tarball.
    files: ["dist"],
  };

  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    `${JSON.stringify(pkg, null, 2)}\n`,
  );
  fs.cpSync(path.join(TOOLKIT_DIR, "brand"), path.join(targetDir, "brand"), {
    recursive: true,
  });
  // dist/ is deliberately NOT ignored — it is published.
  fs.writeFileSync(path.join(targetDir, ".gitignore"), "node_modules\n");

  return { name, version: pkg.version, dir: targetDir };
}

module.exports = { init, titleCase, toolkitVersion, TOOLKIT_DIR };