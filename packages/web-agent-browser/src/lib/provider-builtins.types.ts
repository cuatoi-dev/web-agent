import type { ModelDef, WireFormat } from "./types";

/** One wire format a built-in provider accepts, with the endpoint that format
 *  calls. The first entry is the provider's default format. */
export interface BuiltInFormat {
  wireFormat: WireFormat;
  endpoint: string;
}

/** One entry of the Provider select in the "+ Add model" form. */
export interface BuiltIn {
  /** Stable id, saved on the provider as `CustomProvider.builtIn`. */
  id: string;
  /** Select label and form title. */
  name: string;
  /** At least one entry; the first is the default format. */
  formats: BuiltInFormat[];
  /** The known model list. Empty when the provider has none. */
  models: ModelDef[];
}
