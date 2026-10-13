import type { GalleryState } from './gallery-states';

/**
 * docs-site is the intentionally lean host: it registers only genuiRenderers
 * (no chartingRenderers) and asserts in bundle-absence.test.ts that chart.js is
 * NOT bundled. So chart blocks have no renderer here and would fall through to the
 * "Unsupported block type: chart" card. Skip any gallery state that embeds a chart
 * block rather than showing that error. cat-store (which registers chartingRenderers)
 * still renders every chart state — this filter is host-local to docs-site.
 */
export function requiresCharting(gs: GalleryState): boolean {
  const msgs = gs.state?.messages ?? [];
  return msgs.some(
    (m) =>
      (m.parts?.some((p) => p.kind === 'block' && p.block?.type === 'chart') ?? false) ||
      (m.blocks?.some((b) => b.type === 'chart') ?? false),
  );
}
