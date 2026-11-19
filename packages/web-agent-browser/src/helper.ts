// The webpack entry for dist-template/helper.js. The side panel reads
// this file's TEXT and evaluates it inside an isolated world, so it must be one
// self-contained bundle that installs itself on globalThis and nothing else.
import * as api from "./lib/helper-api";

(globalThis as unknown as { __waHelper: typeof api }).__waHelper = api;
