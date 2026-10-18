// 127/003 — `vfs` is required on the page-tool builders, so a caller that
// forgets it must not compile. Type errors are asserted with @ts-expect-error;
// vitest runs this file with --typecheck.only.
import { describe, expectTypeOf, it } from "vitest";
import { createPanelPageTools, panelPageTools } from "./panel-page-tools";
import { createPageScreenshotTool } from "./page-screenshot-tool";
import { createScriptPageTools } from "./panel-page-tools-script";
import { createNetworkDialogPageTools } from "./panel-page-tools-network-dialog";
import { testVfs } from "./test-vfs";

describe("the page tool builders require a vfs handle", () => {
  it("rejects a missing or empty options object", () => {
    // @ts-expect-error vfs is required
    createPanelPageTools();
    // @ts-expect-error vfs is required
    createPanelPageTools({});
    // @ts-expect-error vfs is required
    panelPageTools();
    // @ts-expect-error vfs is required
    createPageScreenshotTool();
    // @ts-expect-error vfs is required
    createPageScreenshotTool({});
    // @ts-expect-error vfs is required
    createScriptPageTools({});
    // @ts-expect-error vfs is required
    createNetworkDialogPageTools();
  });

  it("accepts a handle alongside the other options", () => {
    expectTypeOf(createPanelPageTools({ vfs: testVfs() })).toBeArray();
    expectTypeOf(createPanelPageTools({ vfs: testVfs(), debuggerSession: undefined })).toBeArray();
    expectTypeOf(panelPageTools({ vfs: testVfs() })).toBeArray();
    expectTypeOf(createPageScreenshotTool({ vfs: testVfs() })).not.toBeNever();
    expectTypeOf(createScriptPageTools({ vfs: testVfs() })).toBeArray();
    expectTypeOf(createNetworkDialogPageTools({ vfs: testVfs() })).toBeArray();
  });
});