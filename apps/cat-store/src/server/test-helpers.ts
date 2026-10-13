import type { Express } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { TestServer } from "./types.js";

export type { TestServer } from "./types.js";

/** Read a JSON body as a known shape. `res.json()` is `any`; this is the
 *  one place the tests say what they expect back. */
export async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function startTestServer(app: Express): Promise<TestServer> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
