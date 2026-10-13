import type {
  CustomToolDef,
  LoadToolProvidersResult,
  ToolProvider,
  ToolProviderFailure,
} from "./types.js";
export type {
  LoadToolProvidersResult,
  ToolProvider,
  ToolProviderFailure,
} from "./types.js";

/** Thrown when a provider declared `required: true` fails to load. */
export class RequiredToolProviderError extends Error {
  readonly failures: ToolProviderFailure[];
  constructor(failures: ToolProviderFailure[]) {
    const detail = failures
      .map((f) => `"${f.provider.name}": ${errText(f.error)}`)
      .join("; ");
    super(`Required tool provider(s) failed to load — ${detail}`);
    this.name = "RequiredToolProviderError";
    this.failures = failures;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Load every configured provider **concurrently** and collect their tools.
 *
 * - Every `load()` is started in the same tick, so a slow provider never
 *   serialises a fast one.
 * - A `required: false` provider that fails is `console.warn`-logged and
 *   contributes no tools.
 * - If any `required: true` provider fails, every provider that already loaded is
 *   disposed and a {@link RequiredToolProviderError} is thrown.
 */
export async function loadToolProviders(
  providers: ToolProvider[] | undefined,
): Promise<LoadToolProvidersResult> {
  if (!providers || providers.length === 0) {
    return { tools: [], loaded: [], failures: [] };
  }

  const settled = await Promise.allSettled(providers.map((p) => p.load()));

  const tools: CustomToolDef[] = [];
  const loaded: ToolProvider[] = [];
  const failures: ToolProviderFailure[] = [];
  const requiredFailures: ToolProviderFailure[] = [];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      loaded.push(provider);
      tools.push(...outcome.value);
      continue;
    }
    const failure: ToolProviderFailure = { provider, error: outcome.reason };
    if (provider.required) {
      requiredFailures.push(failure);
    } else {
      failures.push(failure);
      console.warn(
        `[tools] optional tool provider "${provider.name}" failed to load — ` +
          `its tools are unavailable this session: ${errText(outcome.reason)}`,
        outcome.reason,
      );
    }
  }

  if (requiredFailures.length > 0) {
    await Promise.allSettled(loaded.map((p) => p.dispose?.()) as Promise<void>[]);
    throw new RequiredToolProviderError(requiredFailures);
  }

  return { tools, loaded, failures };
}
