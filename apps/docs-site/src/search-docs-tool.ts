import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import docsIndex from "./generated/docs-index.json";
import type { DocsPage } from "./types";

export const searchDocsTool: CustomToolDef = {
  name: "search_docs",
  description:
    "Search the Web Agent documentation pages by keyword or topic. " +
    "Returns matching page titles, slugs, and relevant text snippets. " +
    "Include the UI framework in the query (e.g. 'lit3 registry', 'lit 1 registry') " +
    "to get framework-correct results.",
  inputSchema: z.object({
    query: z.string().describe(
      "Search terms — include framework context when relevant (e.g. 'lit3', 'embedding', 'theming')."
    ),
  }).strict(),
  promptSnippet:
    "Use search_docs({query}) to find relevant documentation pages across all Web Agent docs. " +
    "Always include the user's framework (e.g. 'lit3 registry') when they ask about the UI registry.",
  renderer: (input) => {
    const { query } = input as { query?: string };
    return query
      ? `Searched the docs for <b>${query}</b> 📚`
      : `Searched the docs 📚`;
  },
  execute: (input: Record<string, unknown>) => {
    const { query } = input as { query: string };
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const scored = (docsIndex as DocsPage[])
      .map((page) => {
        const haystack = (page.title + " " + page.text).toLowerCase();
        const hits = terms.filter((t) => haystack.includes(t)).length;
        return { page, hits };
      })
      .filter(({ hits }) => hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 5);

    if (scored.length === 0) {
      return Promise.resolve({
        content: `No documentation pages matched "${query}". Try broader terms or a different keyword.`,
        isError: false,
      });
    }

    const results = scored.map(({ page }) => {
      const lc = page.text.toLowerCase();
      const firstIdx = terms.map((t) => lc.indexOf(t)).find((i) => i >= 0) ?? 0;
      const snippet = page.text
        .slice(Math.max(0, firstIdx - 40), firstIdx + 200)
        .trim();
      const category = page.category ?? "Guides";
      const folder = page.folder ?? (category === "Beer CSS Reference" ? "beercss" : "guides");
      const route = `#/${folder}/${page.slug}`;
      return `**${page.title}** [${category}] (slug: \`${page.slug}\`, route: \`${route}\`)\n${snippet}`;
    });

    return Promise.resolve({ content: results.join("\n\n---\n\n") });
  },
};
