import type {
  FieldSchema, FieldType, DataQuery, QueryResult, SourceInfo, SourceSummary,
  SourceEntry,
} from "./types.js";
export type { SourceEntry } from "./types.js";
import { runQuery } from "./query-engine.js";

/**
 * Reduce a described source to what the listing sends the model. Counts
 * describe the `SourceInfo` handed in, so a source wrapped by
 * `withAllowList` is summarised from its already-narrowed fields and the
 * counts never describe a field the host hid.
 */
export function summarizeSource(info: SourceInfo): SourceSummary {
  const fieldTypes: Partial<Record<FieldType, number>> = {};
  for (const field of info.fields) {
    fieldTypes[field.type] = (fieldTypes[field.type] ?? 0) + 1;
  }
  const summary: SourceSummary = {
    name: info.name,
    description: info.description,
    rowCount: info.rowCount,
    fieldCount: info.fields.length,
    fieldTypes,
  };
  if (info.error) summary.error = info.error;
  return summary;
}

/**
 * Registry of named data sources.
 */
export class SourceRegistry {
  private _sources = new Map<string, SourceEntry>();

  /** Register a source entry. Overwrites if name already exists. */
  register(name: string, entry: SourceEntry): void {
    this._sources.set(name, entry);
  }

  /** Register a source backed by a static in-memory row array (wraps runQuery). */
  registerStatic(name: string, description: string, fields: FieldSchema[], rows: Record<string, unknown>[]): void {
    this._sources.set(name, {
      describe(): SourceInfo {
        return { name, description, fields, rowCount: rows.length };
      },
      async query(q: DataQuery): Promise<QueryResult> {
        // `require-await`: no internal await, but runQuery can throw, so
        // dropping `async` would turn that into a synchronous throw instead
        // of a rejection.
        await Promise.resolve();
        return runQuery(rows, fields, q);
      },
      async sampleValues(field: string, limit = 20): Promise<{ values: (string | number | boolean)[]; hasMore: boolean }> {
        // `require-await`: no internal await, but iterating `rows` can throw,
        // so dropping `async` would turn that into a synchronous throw
        // instead of a rejection.
        await Promise.resolve();
        const distinct = new Set<string | number | boolean>();
        for (const row of rows) {
          const val = row[field];
          if (val !== undefined && val !== null) {
            distinct.add(val as string | number | boolean);
          }
        }
        const allValues = Array.from(distinct);
        const hasMore = allValues.length > limit;
        return {
          values: allValues.slice(0, limit),
          hasMore,
        };
      },
    });
  }

  /** Look up a source by name. Returns undefined if not found. */
  get(name: string): SourceEntry | undefined {
    return this._sources.get(name);
  }

  /** List all registered source names. */
  names(): string[] {
    return [...this._sources.keys()];
  }

  /** Summarise all registered sources — no field detail. Awaits sources
   *  whose describe() is async. Call `get(name).describe()` for fields. */
  async listSources(): Promise<SourceSummary[]> {
    const result: SourceSummary[] = [];
    for (const entry of this._sources.values()) {
      result.push(summarizeSource(await entry.describe()));
    }
    return result;
  }
}
