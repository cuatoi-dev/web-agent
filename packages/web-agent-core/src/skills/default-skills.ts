import type { SkillDef } from "../tools/skill-def.types.js";

export const DEFAULT_SKILLS: SkillDef[] = [
  {
    name: "query_data_advanced",
    description: "Guide for complex data queries: filters, aggregation, sorting, and pagination.",
    definition: `# query_data_advanced

Use \`query_data\` for all tabular reads. First call \`list_data_sources\` with no
argument to see which sources exist and how big each one is. For wide sources
or specific fields, call \`get_field_details({ source: "<name>", filter: "..." })\`
to find fields and \`sample_field_values({ source: "<name>", field: "<field>" })\`
to inspect distinct values. You can also call \`list_data_sources({ source: "<name>" })\`
for the full field schemas of the one you picked. Never guess a field name.

## Free-text search
Set \`search\` when you do not know which field holds the term:
\`{ "source": "orders", "search": "salmon" }\`
- Matches any string or enum field of the source, case-insensitively.
- Combines with \`filter\` as AND, and applies before aggregation.
- Numbers, booleans and dates are never matched as text — searching "49" does
  not match a total of 49.99.
- Prefer \`{ field: { $contains: "…" } }\` when you know the field; that one
  matches a single named field and is case-sensitive.

## Filters (MongoDB-style)
- Exact match shorthand: \`{ status: "delivered" }\`
- Range: \`{ total: { $gt: 10, $lt: 100 } }\`
- Logical: \`{ $and: [{ status: "delivered" }, { total: { $gt: 50 } }] }\`
- Negation: \`{ status: { $ne: "cancelled" } }\`

## Aggregation
Pass an \`aggregate\` block with:
- \`groupBy\`: array of dimension objects \`{ field, granularity?, as? }\` (e.g. \`[{ "field": "category" }]\`)
- Date dimensions accept \`granularity\`: minute/hour/day/week/month/quarter/year (e.g. \`{ "field": "ts", "granularity": "hour" }\`)
- \`measures\`: array of \`{ field, op, as? }\` where op is count/sum/avg/min/max/countDistinct/first/last (first/last = open/close within each group, ordered by the group's date dimension)
- Optional: \`having\`, \`sort\`, \`limit\`

The \`sort\` above is the one INSIDE the aggregate block, and it names a result
column — the \`as\` alias, or \`<field>_<granularity>\` / \`<op>_<field>\` /
\`count\` when you set no \`as\`. A top-level \`sort\` or \`select\` next to an
aggregate is rejected with an error that lists this query's result columns;
read it and move the sort inside the aggregate block.

Example: total revenue per category, top 5:
\`\`\`json
{
  "source": "orders",
  "aggregate": {
    "groupBy": [{ "field": "category" }],
    "measures": [{ "field": "total", "op": "sum", "as": "revenue" }],
    "sort": [{ "field": "revenue", "dir": "desc" }],
    "limit": 5
  }
}
\`\`\`

## Column projection
Always pass \`select\` with the columns you need on a row query:
\`{ "source": "orders", "select": ["id", "total"], "page": { "limit": 20 } }\`
- A source's field count comes from \`list_data_sources\`. A wide source
  answers a row query with no \`select\` with an error that names its column
  count — read it, choose the columns that answer the question, and query
  again. Do not ask the user which columns to use.
- \`get_field_details({ source: "<name>", filter: "..." })\` finds column
  names; \`sample_field_values\` shows what a column holds.
- Fewer columns is also less truncation: the same 50 rows cost about 32
  times less at ten columns than at three hundred.
- Aggregate queries return only their grouping and measure columns, so they
  never need \`select\`.

## Pagination
Use \`offset\` and \`limit\` for large result sets.

## Field limitations and unavailable fields
The summary from \`list_data_sources\` reports a source-level \`error\`.
\`get_field_details({ source: "<name>" })\` reports the other two, so you do not
need the full \`list_data_sources({ source: "<name>" })\` payload for either.
Read them before you write a query, and quote them to the user instead of
guessing a cause.
- A field with a \`limitation\` string can be read and free-text searched, but
  NOT sorted, filtered exactly, or grouped. Use \`search\` for it, and pick a
  different field for \`sort\`, \`filter\` and \`groupBy\`.
- \`unsupportedFields\` lists fields the source holds but cannot expose, each
  with its \`name\`, its \`esType\` and a \`reason\`. The field exists — say so,
  and say why it cannot be used.
  \`get_field_details\` returns this list too, narrowed by your \`filter\` on
  the field name and the \`esType\`. When a user names a field you cannot find
  in \`fields\`, call \`get_field_details({ source: "<name>", filter: "<field>" })\`
  and check \`unsupportedFields\` before you say the field does not exist. The
  key is absent when the source has none.
- A source-level \`error\` means schema discovery failed. Report the message as
  written. Do not describe the source as empty and do not invent a cause.
`,
  },
  {
    name: "present_to_user",
    description:
      "How to present rich UI to the user — when and how to call show_chart and " +
      "show_generative_ui (charts, buttons, forms) with the intent→render→confirm pattern.",
    definition: `# Presenting rich UI to the user

Use the present_to_user tools instead of writing markdown tables or fenced blocks.

## Tools
- **show_chart({title?, config})** — Chart.js chart. Call \`load_skill("chart")\`
  first for the config shape, type rules, and worked examples.
- **show_generative_ui(spec)** — type:"buttons" (≤6 {label, prompt} quick replies)
  or type:"form" ({id, fields:[{kind,name,label,...}], submit_label}).

## Pattern (interleaves text and UI in one turn)
1. Send a short line: what you're about to show.
2. Call the tool (the block renders inline at that point).
3. Send a brief closing line.

## On error
The tool returns a precise field-path error when the spec is invalid. Read it,
fix the offending field, and call the tool again. Do NOT fall back to fenced
blocks or markdown.`,
  },
];

export function coreSkills(): SkillDef[] {
  return DEFAULT_SKILLS;
}
