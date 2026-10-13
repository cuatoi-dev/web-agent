// snapshot-walk.ts — the shared traversal core behind `DomAdapter.snapshot()`
// and `DomAdapter.snapshotFocused()`. Split out of dom-adapter.ts, with the
// adapter state it reads passed in as `ctx`.

import type { InteractiveCache, QueueItem } from "./types.js";
import type { SnapshotWalkContext } from "./adapter-contexts.types.js";
import { getName, getRole, isInteractive, tagLC } from "./element-semantics.js";
import { countSignificant, esc, skipElement, stateTags } from "./snapshot-format.js";
import { resolveAgentPermission } from "./permission-resolver.js";
import { makeTermMatcher } from "./snapshot-match.js";

function getChildren(node: Node): Node[] {
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  if (tagLC(el) === "slot") {
    return Array.from((el as HTMLSlotElement).assignedNodes({ flatten: true }));
  }
  const result: Node[] = Array.from(el.childNodes);
  if (el.shadowRoot) {
    const shadowRootEl = el.shadowRoot as unknown as Element;
    result.push(...Array.from(shadowRootEl.childNodes));
  }
  return result;
}

/** Shared traversal core for `snapshot()` and `snapshotFocused()` — walks
 *  from `walkRoot`, respecting the same depth/subtree/node budgets, and
 *  returns the rendered lines (no `generation: N` prefix — callers add
 *  that). `forceRootRef` guarantees `walkRoot` itself gets a ref even when
 *  it isn't "interactive" per `isInteractive()` (e.g. a pinned element with
 *  a non-interactive ARIA role like `role="listitem"`), by reusing pass 3's
 *  existing "assign + prefix onto the pushed line" trick.
 *
 *  Selection is breadth-first: a global FIFO queue picks which nodes survive
 *  the node budget, so the budget is spent level-by-level across the whole
 *  page instead of exhausted on whichever branch comes first in document
 *  order. Rendering stays in document order — pass 2 walks the selected set
 *  pre-order, so the output still reads as a nested indented tree, not a
 *  level-ordered list. `subtreeMaxNodes` still limits selection: an
 *  unfiltered walk enqueues only the first `subtreeMaxNodes` children of
 *  each parent. `countSignificant`, which feeds the collapse arithmetic,
 *  does not read it. */
export function walkFromRoot(
  ctx: SnapshotWalkContext,
  walkRoot: Node,
  interactiveOnly: boolean,
  opts?: { forceRootRef?: boolean; charPrefixLen?: number; includeText?: string },
): { text: string; rootRef: number | undefined } {
  const maxDepth = (typeof window !== "undefined" && window.__TINY_BUDGETS__) ? 3 : ctx.snapshotMaxDepth;
  const maxNodes = (typeof window !== "undefined" && window.__TINY_BUDGETS__) ? 15 : ctx.snapshotMaxNodes;
  // A per-parent sibling cap, unrelated to the global BFS depth/node budgets
  // above. Without it, one parent with hundreds of children (Wikipedia's
  // 240-language list, measured live) floods the FIFO queue and the global
  // budget is spent entirely on that one level before BFS ever reaches a
  // sibling branch — the same failure DFS had, recreated one level shallower.
  // Capped fan-out means EVERY parent, not just the unlucky first branch,
  // gets a fair share of the budget. The uncapped remainder is never
  // enqueued, so it is never selected or rendered — pass 3's existing
  // `countSignificant` vs rendered-descendants arithmetic already reports it
  // as hidden, with no new marker type.
  const subtreeMaxNodes = (typeof window !== "undefined" && window.__TINY_BUDGETS__) ? 5 : ctx.snapshotSubtreeMaxNodes;

  // 002: the `include_text` filter. `matchesTerm` is true for every node when
  // no term is set, so every branch below keeps its task-001 behaviour exactly
  // and an unfiltered snapshot stays byte-identical.
  const term = (opts?.includeText ?? "").trim();
  const filtering = term.length > 0;
  const matchesTerm = makeTermMatcher(opts?.includeText);

  // Shared across every isInteractive() call this walk makes — see
  // `InteractiveCache`. Without it, `isPointerControl`'s ancestor/descendant
  // checks re-derive the same elements' status from every candidate that
  // shares an ancestor chain, which is quadratic at best and, on a page
  // with several nested `cursor: pointer` wrappers, recurses deeply enough
  // to overflow the call stack.
  const interactiveCache: InteractiveCache = new Map();

  const isSignificant = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (interactiveOnly) return false;
      const text = node.textContent?.trim();
      if (!text) return false;
      // Skip text that is a direct child of an interactive element
      // (its role/name already covers it).
      const parent = node.parentElement;
      if (parent && isInteractive(parent, interactiveCache)) return false;
      return true;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (opts?.forceRootRef && el === walkRoot) return true;
      return !!getRole(el) || isInteractive(el, interactiveCache);
    }
    return false;
  };

  // ---- PASS 1: choose the nodes, breadth-first, under the global budget ----
  const selectedSet = new Set<Node>();
  const selectedList: Array<{ node: Node; depth: number }> = [];
  const hasSelectedDescendants = new Set<Node>();

  const queue: QueueItem[] = [{ node: walkRoot, depth: 0, ancestors: [] }];

  while (queue.length > 0 && selectedList.length < maxNodes) {
    const { node, depth, ancestors } = queue.shift()!;

    if (depth > maxDepth) continue;

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      // Skip S4 elements
      if (skipElement(el)) continue;
      // Skip agent UI subtree (SEC6) — also check across shadow boundaries
      if (ctx.agentUiEl && (el === ctx.agentUiEl || ctx.agentUiEl.contains(el))) continue;
    }

    const sig = isSignificant(node);
    // 002: the term gates SELECTION only, never traversal. An element can
    // match through an attribute that its ancestors' `textContent` does not
    // carry — `a[title="Edit this at Wikidata"]` has empty text — so pruning
    // the branch above a non-matching node would make that element
    // unreachable. Measured on the live article on 2026-09-12: pruning lost 2
    // of 29 `Wikidata` matches, including exactly that control.
    const selectable = sig && matchesTerm(node);
    if (selectable) {
      selectedSet.add(node);
      selectedList.push({ node, depth });
      for (const anc of ancestors) {
        hasSelectedDescendants.add(anc);
      }
    }

    if (selectedList.length >= maxNodes) break;

    if (node.nodeType === Node.ELEMENT_NODE) {
      // Cap fan-out at the parent, not just the global budget — see
      // `subtreeMaxNodes` above.
      // 002: the per-parent cap exists to stop one very wide parent spending
      // the global node budget (see `subtreeMaxNodes` above). Under a term the
      // budget is spent only on MATCHING nodes, so the cap protects nothing —
      // and it would silently drop a matching descendant sitting past the cap,
      // which is the same "unreachable match" failure 5d exists to prevent.
      // Filtering the children by `matchesTerm` before slicing does NOT fix
      // that: a child that merely CONTAINS the match does not match itself. So
      // a filtered walk enqueues every child.
      const children = filtering
        ? getChildren(node)
        : getChildren(node).slice(0, subtreeMaxNodes);
      // A significant node queues its children one level deeper; a
      // non-significant one (no role, not interactive) queues them at the
      // SAME depth — it contributes no indentation of its own, so it must
      // not cost the subtree a depth level either.
      const nextDepth = sig ? depth + 1 : depth;
      const nextAncestors = [...ancestors, node];
      for (const child of children) {
        queue.push({ node: child, depth: nextDepth, ancestors: nextAncestors });
      }
    }
  }

  // 002: an unmatched term explains itself rather than returning an empty tree
  // that reads as a broken tool. The caller prepends `generation: N\n`, exactly
  // as it does for every other snapshot result.
  if (filtering && selectedList.length === 0) {
    return {
      text: `No element contains "${term}". Take a snapshot without include_text to see the page, or try a shorter term.`,
      rootRef: undefined,
    };
  }

  // ---- PASS 2: render the SELECTED set as a tree, in DOCUMENT order ----
  const lines: string[] = [];
  const assignedRefs = new Map<Element, number>();
  const lineIndices = new Map<Element, number>();
  const renderedElements: Element[] = [];
  const renderedChildrenMap = new Map<Element, Node[]>();

  const renderWalk = (node: Node, currentDepth: number, parentSelectedEl: Element | null): void => {
    if (!selectedSet.has(node) && !hasSelectedDescendants.has(node)) return;

    if (node.nodeType === Node.TEXT_NODE) {
      if (selectedSet.has(node)) {
        const text = node.textContent?.trim() ?? "";
        const indent = "  ".repeat(currentDepth);
        lines.push(`${indent}text "${esc(text)}"`);
        if (parentSelectedEl) {
          let list = renderedChildrenMap.get(parentSelectedEl);
          if (!list) {
            list = [];
            renderedChildrenMap.set(parentSelectedEl, list);
          }
          list.push(node);
        }
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;

    if (skipElement(el)) return;
    if (ctx.agentUiEl && (el === ctx.agentUiEl || ctx.agentUiEl.contains(el))) return;

    // 002: under a term, a significant ancestor of a match emits its line too
    // — that is what makes the result a pruned TREE instead of a flat list of
    // hits. Pass 1 already credits the whole ancestor chain of every selected
    // node into `hasSelectedDescendants`, so this needs no extra traversal.
    // With no term, `filtering` is false and this is the previous expression.
    const isSel = selectedSet.has(el) ||
      (filtering && hasSelectedDescendants.has(el) && isSignificant(el));
    let nextParentEl = parentSelectedEl;
    let nextDepth = currentDepth;

    if (isSel) {
      const interactive = isInteractive(el, interactiveCache);
      const role = getRole(el);
      const indent = "  ".repeat(currentDepth);

      let line = indent;

      // Ref for interactive elements (§5.1 S2)
      if (interactive) {
        const ref = ctx.refTable.assign(el);
        assignedRefs.set(el, ref);
        line += `[${ref}] `;
      }

      // A ref'd element with no ARIA role would otherwise print an empty role
      // slot — measured before this change: `[1]  "ONCLICK-ATTR-NOTEXTLABEL"`,
      // with two spaces and no word. Name it for what the agent can do with it.
      line += role || (interactive ? "button" : "");

      const name = getName(el);
      if (name) line += ` "${esc(name)}"`;

      // State tags (§5.1 S3)
      line += stateTags(el, role);

      // Extra annotation for headings
      if (role === "heading") {
        line += ` (${tagLC(el)})`;
      }

      // §022-002: permission annotation — follows the same resolution as
      // enforcement (resolveAgentPermission walks light-DOM ancestors and
      // open shadow-root hosts), so the model sees the gate on the ref'd control.
      if (interactive) {
        const { permission: refPerm } = resolveAgentPermission(el);
        if (refPerm === "ask" || refPerm === "block") {
          line += ` (${refPerm})`;
        }
      }

      lineIndices.set(el, lines.length);
      lines.push(line);
      renderedElements.push(el);

      if (parentSelectedEl) {
        let list = renderedChildrenMap.get(parentSelectedEl);
        if (!list) {
          list = [];
          renderedChildrenMap.set(parentSelectedEl, list);
        }
        list.push(el);
      }

      nextParentEl = el;
      nextDepth = currentDepth + 1;
    }

    for (const child of getChildren(el)) {
      renderWalk(child, nextDepth, nextParentEl);
    }
  };

  renderWalk(walkRoot, 0, null);

  if (opts?.forceRootRef && walkRoot.nodeType === Node.ELEMENT_NODE) {
    const rootEl = walkRoot as Element;
    if (!assignedRefs.has(rootEl)) {
      const ref = ctx.refTable.assign(rootEl);
      assignedRefs.set(rootEl, ref);
      const lineIdx = lineIndices.get(rootEl);
      if (lineIdx !== undefined) {
        lines[lineIdx] = lines[lineIdx].replace(/^(\s*)/, `$1[${ref}] `);
      }
    }
  }

  // ---- PASS 3: collapse markers, unchanged in meaning ----
  // Bottom-up: total significant descendants minus rendered descendants,
  // attributed to the deepest boundary node so a hidden count is never
  // double-reported by an ancestor that already reports it.
  const totalRenderedDescendants = new Map<Element, number>();
  const totalHiddenMap = new Map<Element, number>();

  for (let i = renderedElements.length - 1; i >= 0; i--) {
    const el = renderedElements[i];
    const children = renderedChildrenMap.get(el) ?? [];

    let renderedDescendants = 0;
    for (const child of children) {
      // 002: count only rendered nodes that are themselves matches. Under a
      // term, `children` also holds ancestor-context lines, which
      // `countSignificant` — given the same matcher — does not count, so
      // counting them here would understate the hidden total and suppress a
      // real marker. Unfiltered, every rendered node is in `selectedSet`, so
      // this is a no-op.
      if (selectedSet.has(child)) renderedDescendants += 1;
      if (child.nodeType === Node.ELEMENT_NODE) {
        renderedDescendants += totalRenderedDescendants.get(child as Element) ?? 0;
      }
    }
    totalRenderedDescendants.set(el, renderedDescendants);

    const totalSignificant = countSignificant(el, interactiveOnly, ctx.agentUiEl, interactiveCache, matchesTerm);
    const totalHidden = Math.max(0, totalSignificant - renderedDescendants);
    totalHiddenMap.set(el, totalHidden);

    let hiddenUnderChildren = 0;
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        hiddenUnderChildren += totalHiddenMap.get(child as Element) ?? 0;
      }
    }

    const hiddenDirectly = Math.max(0, totalHidden - hiddenUnderChildren);
    if (hiddenDirectly > 0) {
      // ensure the boundary node has a ref (assign if it was non-interactive)
      let boundaryRef = assignedRefs.get(el);
      if (!boundaryRef) {
        boundaryRef = ctx.refTable.assign(el);
        assignedRefs.set(el, boundaryRef);
        // prefix the ref onto el's already-pushed line
        const lineIdx = lineIndices.get(el);
        if (lineIdx !== undefined) {
          lines[lineIdx] = lines[lineIdx].replace(/^(\s*)/, `$1[${boundaryRef}] `);
        }
      }
      const lineIdx = lineIndices.get(el);
      if (lineIdx !== undefined) {
        lines[lineIdx] += ` … +${hiddenDirectly} nodes hidden — snapshot_page(scope="${boundaryRef}") to expand`;
      }
    }
  }

  const emitted = lines.length;
  const totalSignificant = countSignificant(walkRoot, interactiveOnly, ctx.agentUiEl, interactiveCache, matchesTerm);
  let output = lines.join("\n");
  if (emitted < totalSignificant && selectedList.length >= maxNodes) {
    const missed = totalSignificant - emitted;
    output += `\n… TRUNCATED: ${missed} more significant nodes not shown ` +
      `(node budget ${maxNodes} reached). ` +
      `Narrow with scope="<ref>" on a section above, or interactive_only=true.`;
  }

  // Final safety net: hard char cap (should now rarely trigger). Accounts
  // for a prefix the caller will prepend (e.g. snapshot()'s "generation: N\n"
  // line) so the cap applies to the full string the caller returns, matching
  // pre-refactor behavior where the prefix was already part of `output`.
  const charPrefixLen = opts?.charPrefixLen ?? 0;
  if (charPrefixLen + output.length > ctx.snapshotMaxChars) {
    output = output.slice(0, Math.max(0, ctx.snapshotMaxChars - charPrefixLen)) +
      `\n… TRUNCATED (char cap ${ctx.snapshotMaxChars}). Use scope or interactive_only to narrow.`;
  }

  const rootRef = walkRoot.nodeType === Node.ELEMENT_NODE
    ? assignedRefs.get(walkRoot as Element)
    : undefined;

  return { text: output, rootRef };
}
