import type {
  DataQuery, FieldDetailsQuery, FieldDetailsResult, FieldSampleQuery,
  FieldSampleResult, FieldSchema, QueryResult, Scalar, SourceInfo, SourceSummary,
} from "./types.js";
import type { DataSourceProvider, ProviderOptions } from "./types.js";
export type { DataSourceProvider, ProviderOptions } from "./types.js";
import { SourceRegistry } from "./registry.js";
import { withAllowList } from "./allow-list.js";

// ---------------------------------------------------------------------------
// Interface: DataSourceProvider and ProviderOptions live in types.ts
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createDataSourceProvider(opts: ProviderOptions): DataSourceProvider {
  const { sources } = opts;
  const registry = new SourceRegistry();

  // describe() may be async (e.g. cat-store's orders source fetches
  // /api/orders/describe), so registration is a promise every method awaits.
  const ready = Promise.all(
    sources.map(async (source) => {
      try {
        const entry = source.allowFields?.length
          ? withAllowList(source, source.allowFields)
          : source;
        const info = await entry.describe();
        registry.register(info.name, entry);
      } catch (err) {
        // A cancelled request ends source discovery without a failure report.
        if ((err as { name?: unknown } | null | undefined)?.name !== "AbortError") {
          console.error("Failed to describe source", err);
        }
      }
    })
  );

  // Build the provider
  const provider: DataSourceProvider = {
    async listSources(): Promise<SourceSummary[]> {
      await ready;
      return registry.listSources();
    },

    async describeSource(name: string): Promise<SourceInfo> {
      await ready;
      const entry = registry.get(name);
      if (!entry) {
        throw new Error(`Unknown source "${name}". Available: ${registry.names().join(", ")}.`);
      }
      return entry.describe();
    },

    async getFieldDetails(query: FieldDetailsQuery): Promise<FieldDetailsResult> {
      await ready;
      // describeSource() goes through withAllowList, so info.fields AND
      // info.unsupportedFields are already narrowed to what the host exposed
      // (allow-list.ts:59-75). Nothing here can widen that.
      const info = await provider.describeSource(query.source);
      let fields = info.fields;
      const needle = query.filter?.trim().toLowerCase();
      if (needle) {
        fields = fields.filter((f) => {
          const nameMatch = f.name.toLowerCase().includes(needle);
          const labelMatch = f.label?.toLowerCase().includes(needle) ?? false;
          const descMatch = f.description?.toLowerCase().includes(needle) ?? false;
          return nameMatch || labelMatch || descMatch;
        });
      }
      const total = fields.length;
      const offset = query.offset ?? 0;
      const rawLimit = query.limit ?? 50;
      const limit = Math.min(Math.max(rawLimit, 1), 500);
      const pagedFields = fields.slice(offset, offset + limit).map((f) => {
        const out: FieldSchema = { name: f.name, type: f.type };
        if (f.label) out.label = f.label;
        if (f.description) out.description = f.description;
        if (f.limitation) out.limitation = f.limitation;
        return out;
      });
      // The same filter narrows the unsupported report, on name and esType
      // only. `reason` is boilerplate prose holding the words "selected",
      // "filtered", "sorted" and "grouped", so matching it would make
      // filter: "sort" return every unsupported field in the source.
      const unsupported = (info.unsupportedFields ?? []).filter(
        (u) =>
          !needle ||
          u.name.toLowerCase().includes(needle) ||
          u.esType.toLowerCase().includes(needle),
      );
      const result: FieldDetailsResult = {
        source: query.source,
        fields: pagedFields,
        total,
        offset,
        limit: pagedFields.length,
        hasMore: offset + pagedFields.length < total,
      };
      // Absent, not empty: a healthy source must not carry an empty array.
      if (unsupported.length > 0) result.unsupportedFields = unsupported;
      return result;
    },

    async sampleValues(query: FieldSampleQuery): Promise<FieldSampleResult> {
      await ready;
      const entry = registry.get(query.source);
      if (!entry) {
        throw new Error(`Unknown source "${query.source}". Available: ${registry.names().join(", ")}.`);
      }
      const limit = Math.min(Math.max(query.limit ?? 20, 1), 500);
      if (entry.sampleValues) {
        const sample = await entry.sampleValues(query.field, limit);
        return {
          source: query.source,
          field: query.field,
          values: sample.values,
          hasMore: sample.hasMore,
          total: sample.values.length,
        };
      }
      // Fallback via query aggregate
      const res = await entry.query({
        source: query.source,
        aggregate: { groupBy: [{ field: query.field }], measures: [], limit: limit + 1 },
      });
      const hasMore = res.rows.length > limit;
      const values = res.rows.slice(0, limit).map((r) => r[query.field] as Scalar);
      return {
        source: query.source,
        field: query.field,
        values,
        hasMore,
        total: values.length,
      };
    },

    async query(q: DataQuery): Promise<QueryResult> {
      await ready;
      const entry = registry.get(q.source);
      if (!entry) {
        throw new Error(`Unknown source "${q.source}". Available: ${registry.names().join(", ")}.`);
      }
      return entry.query(q);
    },
  };

  return provider;
}
