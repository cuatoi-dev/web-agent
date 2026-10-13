// The fallback chain's shapes. Deliberately free of imports: `config.types.ts`
// reads `ProviderFallbackNotice`, and `transport/types.ts` reads `AgentConfig`
// from `config.types.ts`, so these two must not share one file.

/** One provider-and-model pair in a fallback chain. Deliberately minimal: it
 *  carries only what a call needs, so no core type depends on a host type such
 *  as cat-store's `ProviderEntry`. */
export interface FallbackChainEntry {
  /** Any `endpointType` registered in `providerRegistry`, including "mock". */
  endpointType: string;
  /** Model id sent on the wire for this entry. Overrides the call's model. */
  model: string;
  /** Base URL for this entry, in the form its provider expects. */
  baseURL: string;
  /** true → call this entry in streaming mode. Default false. */
  streaming?: boolean;
}

/** What one chain call did. Reported through `AgentConfig.onProviderFallback`. */
export interface ProviderFallbackNotice {
  /** Entries that failed this call, in the order they were tried. */
  failed: { provider: string; model: string; message: string }[];
  /** The entry that answered. Undefined when every entry failed. */
  answered?: { provider: string; model: string };
}
