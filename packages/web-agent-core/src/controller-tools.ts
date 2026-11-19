// The `AvailableTool` projection of a resolved tool list — shared by
// `initAgent()` (controller-config.ts) and `driveTurn()` (controller-turn.ts),
// so the two never drift. Kept in its own leaf module: those two
// files already sit in an import cycle with each other through
// controller-queue.ts, so this helper cannot live in either without cycling.
import type { AvailableTool } from "./controller.types.js";
import type { CustomToolDef } from "./tools/types.js";

export function toAvailableTools(defs: CustomToolDef[]): AvailableTool[] {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    phrase: d.phrase,
    inProgressPhrase: d.inProgressPhrase,
  }));
}
