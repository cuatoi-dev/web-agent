import { css } from "lit";

import { agentPagePanelsStyles } from "./agent-page-panels.styles";

/** The page frame for `<agent-page>`: the host box, the three-column layout,
 *  the generative-UI frame and the resize divider. Moved out of
 *  `agent-page.ts` unchanged. */
const agentPageFrameStyles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      /* 43px is the measured height of .top-bar in app-root.ts. Coupled to
         app-root's header height; re-measure if .top-bar padding/font changes. */
      height: calc(100vh - 43px);
      max-height: calc(100vh - 43px);
      min-height: 0;
      overflow: hidden;
    }
    .layout {
      display: flex;
      flex: 1 1 auto;
      height: 100%;
      min-height: 0;
      /* Anchors the absolutely-positioned divider, which straddles the
         chat/right-panel boundary and takes no layout width. */
      position: relative;
      background: var(--wa-background-color, #f5f5f5);
    }
    .col-sessions,
    .col-side {
      display: flex;
      flex-direction: column;
      min-height: 0;
      box-sizing: border-box;
      overflow: hidden;
      background: var(--wa-background-color-700, #ececec);
    }
    .col-sessions {
      border-right: 1px solid var(--wa-border-color, #e0e0e0);
    }
    .col-side {
      border-left: 1px solid var(--wa-border-color, #e0e0e0);
    }
    .genui-frame {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
      background: var(--wa-background-color, #f5f5f5);
      pointer-events: auto;
    }
    .genui-frame.dragging {
      /* Pointer-events must pass through so the divider pointermove listener
         on the document keeps firing while the pointer crosses the iframe
         during a divider drag. */
      pointer-events: none;
    }
    /* Collapsed: the panel leaves the layout entirely and .col-chat's
       flex: 1 1 auto absorbs the freed width. */
    .col-side.collapsed {
      display: none;
    }
    .col-chat {
      flex: 1 1 auto;
      min-width: 0;
      box-sizing: border-box;
      /* Clears the divider toggle, which floats at top: 4px, so the toggle
         never overlaps the first message bubble — including a short,
         right-aligned user bubble on a phone-width viewport. */
      padding-top: var(--wa-padding-xl, 16px);
      /* Confines agent-chat-panel's own internal content (its .messages-list
         in particular) to ONE stacking-context slot at .layout's level. Without
         this, when the panel is collapsed .col-chat's box comes to overlap the
         divider's fixed screen position, and .messages-list paints over the
         divider despite the divider's z-index: 2 — z-index only orders
         siblings within the SAME stacking context, and .col-chat's internal
         content was escaping it. isolation: isolate is the correct fix, not a
         compositing hack: it forces every descendant here to stay behind
         .col-divider's stacking level, whatever compositing agent-chat-panel
         does internally. */
      isolation: isolate;
    }

    agent-chat-panel[hidden] {
      display: none;
    }

    /* --- divider: drag handle + collapse toggle ---------------------- */
    .col-divider {
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 2;
      width: 12px; /* AGENT_DIVIDER_WIDTH_PX */
      display: flex;
      flex-direction: column;
      align-items: center;
      /* The toggle is positioned OUTSIDE this 12px rail — 8px to the right of
         it when expanded, 8px to the left when collapsed (see
         .divider-toggle). Never clip it. */
      overflow: visible;
      background: var(--wa-background-color-700, #ececec);
      cursor: col-resize;
      touch-action: none;
    }
    /* Collapsed: there is nothing to resize, so the bar is a plain rail that
       only carries the expand button. */
    .col-divider.collapsed {
      cursor: default;
    }
    .divider-toggle {
      /* Floats clear of the rail instead of straddling it. The rail is 12px
         and the button is 24px, so a centred button overhangs 6px into each
         neighbour and reads as a square dropped on the line.
         Absolute inside .col-divider, which is itself positioned, so the
         button rides with the rail on every drag and only the horizontal
         offset is new. left: calc(100% + 8px) puts its left edge 8px right of
         the 12px rail, over the right panel.
         top: 4px sits in the space .col-chat's padding-top now opens above
         the message list, clear of the first bubble at any viewport width. */
      position: absolute;
      top: 4px;
      left: calc(100% + 8px);
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      cursor: pointer;
      color: var(--wa-text-color, #333);
      background: var(--wa-button-background-color, #fff);
      /* --wa-button-border-color is too close in luminance to the panel
         backgrounds the button now sits over (measured ~1.2-1.5:1, below the
         3:1 WCAG SC 1.4.11 floor for a non-text boundary, in both states and
         both themes). --wa-text-color — the same token already used for
         the chevron above — clears 3:1 against every backdrop in every theme
         (measured 11.4-15.9:1), so it doubles as the border colour here. */
      border: 1px solid var(--wa-text-color, #333);
      border-radius: var(--wa-border-radius-m, 4px);
    }
    /* Collapsed, the rail sits at right: 0, so the button stays inside the
       viewport at right: 8px — never off the right edge, and never over the
       chat column where it could sit above a message bubble. left: auto
       clears the expanded rule: setting both left and right would
       over-constrain the box and left would win. */
    .col-divider.collapsed .divider-toggle {
      left: auto;
      right: 8px;
    }
    .divider-toggle:hover {
      background: var(--wa-button-background-color-hover, #e0e0e0);
    }
    .divider-toggle:focus-visible {
      outline: 2px solid var(--wa-outline-color, #6200ee);
      outline-offset: 1px;
    }
    .divider-toggle svg {
      display: block;
      width: 14px;
      height: 14px;
    }
    /* Expanded, the chevron points right — clicking sends the panel away.
       Collapsed, it points left — clicking brings the panel back. Direction is
       shape, not colour, so it survives a greyscale conversion. */
    .col-divider.collapsed .divider-toggle svg {
      transform: rotate(180deg);
    }
    /* Three dots mark the grab area by SHAPE, so the handle is discernible
       without relying on colour. */
    .divider-grip {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 3px;${/* eslint-disable-line wa/no-raw-spacing -- 3px is not on the theme spacing ladder (between --wa-padding-xs 2px and --wa-padding-s 4px); tokenizing would snap the rendered value and change the layout. */ css``}
      pointer-events: none;
    }
    .divider-grip .dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--wa-text-color, #333);
    }
    .col-divider.collapsed .divider-grip {
      display: none;
    }
`;

/** Every style `<agent-page>` adopts, in the order the single `static styles`
 *  block in `agent-page.ts` declared them. */
export const agentPageStyles = [agentPageFrameStyles, agentPagePanelsStyles];
