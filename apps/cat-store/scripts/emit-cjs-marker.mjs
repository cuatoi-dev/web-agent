// apps/cat-store/package.json has no "type" field (webpack.config.js is
// CommonJS), so mark the compiled server output as CommonJS for Node.
import { mkdirSync, writeFileSync } from "node:fs";

const target = new URL("../dist/node/package.json", import.meta.url);
mkdirSync(new URL("../dist/node/", import.meta.url), { recursive: true });
writeFileSync(target, `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
