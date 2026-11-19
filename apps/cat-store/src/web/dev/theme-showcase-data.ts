// Theme showcase data without page bootstrap.
import type { SessionState } from '@cuatoi/web-agent-core';
import { listThemes } from '@cuatoi/web-agent-lit/themes';
import { makeState, FORM_BLOCK, BUTTONS_BLOCK } from './gallery-states';
import type { ShowcaseTheme } from './types';

export type { ShowcaseTheme } from './types';

/** Read registered themes and append the host-provided showcase example. */
export function getShowcaseThemes(): { id: ShowcaseTheme; label: string }[] {
  return [
    ...listThemes().map(({ id, label }) => ({ id, label })),
    { id: 'provided', label: 'Host-provided (wa2-light + custom info/border)' },
  ];
}

/** URL of the theme-showcase demo in single-card mode, themed. */
export function frameUrl(theme: ShowcaseTheme): string {
  return `gallery.html?frame=demo-theme-showcase&showcase=1&theme=${theme}`;
}

/** One canned conversation, identical in all four frames: a user turn, an
 *  assistant turn, and two rendered generative-UI blocks. */
export function buildShowcaseState(): SessionState {
  return makeState({
    messages: [
      { role: 'user', text: 'Which cans do you stock?' },
      {
        role: 'assistant',
        parts: [
          { kind: 'text', text: 'We carry salmon, tuna, chicken and turkey — filter them here:' },
          { kind: 'block', block: FORM_BLOCK },
          { kind: 'block', block: BUTTONS_BLOCK },
        ],
      },
    ],
    contextWindow: { used: 15360, total: 128000, percent: 12 },
  });
}
