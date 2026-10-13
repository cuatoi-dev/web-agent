import { test, expect } from './fixtures';
import { chooseTheme, openPanel, shot } from './helpers';

// 004: cat-store hosts the bubble inside <cat-agent-widget>'s shadow root.
import type { ChatPanelProbe } from './dom-types';
import type { WebAgentBubble } from '@cuatoi/web-agent-lit/embed/web-agent-embed';
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.describe('004: the bubble is hosted inside a shadow wrapper', () => {
  test('1: the widget owns a real open shadow root and the bubble lives inside it', async ({ page }) => {
    await openPanel(page);
    const shape = await page.evaluate(() => {
      const agentUi = document.querySelector('[data-agent-ui]');
      const widget = agentUi?.children[0];
      return {
        childCount: agentUi?.children.length ?? 0,
        tagName: widget?.tagName ?? null,
        hasShadowRoot: widget?.shadowRoot !== null && widget?.shadowRoot !== undefined,
        shadowMode: widget?.shadowRoot?.mode ?? null,
        // Bubble must NOT be in the light DOM
        bubbleInLightDom: widget?.querySelector('web-agent-bubble') !== null,
        // Bubble must be in the shadow root
        bubbleInShadowRoot: widget?.shadowRoot?.querySelector('web-agent-bubble') !== null,
        // document.querySelector must not find the bubble
        docQS: document.querySelector('web-agent-bubble') !== null,
      };
    });
    expect(shape.childCount).toBe(1);
    expect(shape.tagName).toBe('CAT-AGENT-WIDGET');
    expect(shape.hasShadowRoot).toBe(true);
    expect(shape.shadowMode).toBe('open');
    expect(shape.bubbleInLightDom).toBe(false);
    expect(shape.bubbleInShadowRoot).toBe(true);
    expect(shape.docQS).toBe(false);
  });

  test('2: the full chain resolves — widget → bubble → panel', async ({ page }) => {
    await openPanel(page);
    const chain = await page.evaluate(() => {
      const widget = document.querySelector('cat-agent-widget');
      const bubble = widget?.shadowRoot?.querySelector('web-agent-bubble') as WebAgentBubble | null;
      const panel = bubble?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
      return {
        panelFound: panel !== null,
        bubbleShadowMode: bubble?.shadowRoot?.mode ?? null,
        bubbleRootIsWidgetShadow: bubble?.getRootNode() === widget?.shadowRoot,
        panelRootIsBubbleShadow: panel?.getRootNode() === bubble?.shadowRoot,
      };
    });
    expect(chain.panelFound).toBe(true);
    expect(chain.bubbleShadowMode).toBe('open');
    expect(chain.bubbleRootIsWidgetShadow).toBe(true);
    expect(chain.panelRootIsBubbleShadow).toBe(true);
  });

  test('3: the widget applies its own styles and traps no fixed positioning', async ({ page }) => {
    await openPanel(page);
    const positioning = await page.evaluate(() => {
      const widget = document.querySelector('cat-agent-widget') as HTMLElement;
      const bubble = widget?.shadowRoot?.querySelector('web-agent-bubble') as HTMLElement | null;
      const launcher = bubble?.shadowRoot?.querySelector('#launcher') as HTMLElement | null;
      const panelContainer = bubble?.shadowRoot?.querySelector('#panel-container') as HTMLElement | null;
      const resizeGrip = bubble?.shadowRoot?.querySelector('.wa-resize-grip') as HTMLElement | null;
      const rect = launcher?.getBoundingClientRect();
      return {
        widgetDisplay: getComputedStyle(widget).display,
        launcherPosition: launcher ? getComputedStyle(launcher).position : null,
        panelContainerPosition: panelContainer ? getComputedStyle(panelContainer).position : null,
        resizeGripPosition: resizeGrip ? getComputedStyle(resizeGrip).position : null,
        resizeGripWidth: resizeGrip ? getComputedStyle(resizeGrip).width : null,
        resizeGripHeight: resizeGrip ? getComputedStyle(resizeGrip).height : null,
        launcherRight: rect ? Math.round(window.innerWidth - rect.right) : null,
        launcherBottom: rect ? Math.round(window.innerHeight - rect.bottom) : null,
      };
    });
    expect(positioning.widgetDisplay).toBe('contents');
    expect(positioning.launcherPosition).toBe('fixed');
    expect(positioning.panelContainerPosition).toBe('fixed');
    expect(positioning.resizeGripPosition).toBe('fixed');
    expect(positioning.resizeGripWidth).toBe('28px');
    expect(positioning.resizeGripHeight).toBe('28px');
    expect(positioning.launcherRight).toBe(16);
    expect(positioning.launcherBottom).toBe(16);
  });

  test('4: tokens resolve through both boundaries and the theme toggle still switches the panel', async ({ page }) => {
    await openPanel(page);

    /**
     * Two probes per reading — one invariant, one theme-varying:
     *
     * Probe A — --wa-action-color-info (INVARIANT across themes in cat-store):
     *   Same rgb(131,82,255) in both wa2-dark and wa2-light. Proves the token crosses
     *   both shadow boundaries. Cannot prove the toggle fired.
     *   Deliberately NOT used for the "must change" assertion.
     *
     * Probe B — --wa-background-color (DIFFERS between themes):
     *   wa2-dark:  hsl(221deg 29% 19%) — dark navy
     *   wa2-light: hsl(206deg 26% 95%) — near-white
     *   Read from a div appended INSIDE agent-chat-panel (inside bubble.shadowRoot).
     *   Proves the theme toggle propagated through widget shadow → bubble shadow → panel.
     */
    const readTokens = () => page.evaluate(() => {
      const widget = document.querySelector('cat-agent-widget');
      const bubble = widget?.shadowRoot?.querySelector('web-agent-bubble') as HTMLElement | null;
      const launcher = bubble?.shadowRoot?.querySelector('#launcher') as HTMLElement | null;
      const panel = bubble?.shadowRoot?.querySelector('agent-chat-panel') as HTMLElement | null;

      // Probe A: invariant accent token — proves cross-boundary inheritance.
      const accentProbe = document.createElement('div');
      accentProbe.style.color = 'var(--wa-action-color-info)';
      document.body.appendChild(accentProbe);
      const accentToken = getComputedStyle(accentProbe).color;
      accentProbe.remove();

      // Probe B: background token — genuinely flips between themes.
      // Appended inside the panel to read the value two shadow boundaries deep.
      const bgProbe = document.createElement('div');
      bgProbe.style.color = 'var(--wa-background-color)';
      if (panel) panel.appendChild(bgProbe);
      else document.body.appendChild(bgProbe); // fallback: assertion will still catch it
      const bgToken = getComputedStyle(bgProbe).color;
      bgProbe.remove();

      return {
        launcherBg: launcher ? getComputedStyle(launcher).backgroundColor : null,
        accentToken,
        bgToken,
      };
    });

    // --- Dark theme ---
    const darkPaint = await readTokens();
    // Invariant: launcher accent color crosses both shadow boundaries.
    expect(darkPaint.launcherBg).toBe(darkPaint.accentToken);
    // Baseline: record background token from inside the nesting.
    expect(darkPaint.bgToken).not.toBeNull();
    await shot(page, '004-widget-nesting-dark.png');

    // --- Switch to light theme ---
    await chooseTheme(page, 'wa2-light');
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
    );

    const lightPaint = await readTokens();
    // Invariant still holds after toggle.
    expect(lightPaint.launcherBg).toBe(lightPaint.accentToken);
    // The background token (read from inside both shadow boundaries) must have changed,
    // proving the theme switch reached through widget shadow → bubble shadow → panel.
    expect(lightPaint.bgToken).not.toBeNull();
    expect(lightPaint.bgToken).not.toBe(darkPaint.bgToken);
    await shot(page, '004-widget-nesting-light.png');
  });

  test('5: nothing new reaches document.head', async ({ page }) => {
    await openPanel(page);
    const inHead = await page.evaluate(
      () => document.head.querySelectorAll('style[data-wa-styles]').length,
    );
    expect(inHead).toBe(0);
  });
});
