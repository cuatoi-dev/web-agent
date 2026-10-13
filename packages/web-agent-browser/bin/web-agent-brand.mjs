#!/usr/bin/env node
// The brand owner's only entry point.
//
//   web-agent-brand init <dir>   scaffold a new brand package
//   web-agent-brand build        build ./brand into ./dist
//   web-agent-brand --version    print the toolkit version
//
// Every failure is one line on stderr and exit 1. A brand owner's mistake is a
// message naming the file and the fix, never a Node stack trace.
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { build } = require("../tool/build.cjs");
const { init } = require("../tool/init.cjs");
const { version } = require("../package.json");

const USAGE = `web-agent-brand <command>

  init <directory>   create a new brand package in <directory>
  build              build ./brand into ./dist
  --version          print the toolkit version
`;

const [command, target] = process.argv.slice(2);

try {
  if (command === "init") {
    if (!target) throw new Error("init needs a target directory");
    const dir = path.resolve(target);
    init(dir);
    const where = path.relative(process.cwd(), dir) || ".";
    console.log(
      `Created ${dir}.\n\n`
      + "Next steps:\n"
      + `  cd ${where}\n`
      + "  npm install\n"
      + "  edit brand/plugin.yml, brand/model.yml and brand/icon.png\n"
      + "  npm run build\n"
      + "  load dist/ unpacked at chrome://extensions\n",
    );
  } else if (command === "build") {
    build(process.cwd());
  } else if (command === "--version") {
    console.log(version);
  } else {
    process.stderr.write(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}