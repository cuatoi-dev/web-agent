// The gallery lists registered themes and reads the selected id from ?theme=.
// It does not write theme preferences to storage.

import {
  applyTheme as applyRegisteredTheme,
  getTheme,
  listThemes,
} from '@cuatoi/web-agent-lit/themes';
import type { GalleryTheme } from './types';
export type { GalleryTheme } from './types';

export function isGalleryTheme(value: string | null): value is GalleryTheme {
  return value !== null && getTheme(value) !== undefined;
}

/** Read `?theme=` from a query string, falling back when absent/unknown. */
export function resolveTheme(search: string, fallback: GalleryTheme): GalleryTheme {
  const value = new URLSearchParams(search).get('theme');
  return isGalleryTheme(value) ? value : fallback;
}

export function applyTheme(theme: GalleryTheme): void {
  applyRegisteredTheme(document.documentElement, theme);
}

/** Render the selector into `host`. No-op when `host` is null (frame mode). */
export function mountThemeSwitcher(
  host: HTMLElement | null,
  current: GalleryTheme,
  onChange: (theme: GalleryTheme) => void,
): void {
  if (!host) return;
  host.style.cssText =
    'display:flex;align-items:center;gap: var(--wa-padding-m, 8px);margin: 0 0 var(--wa-padding-xl, 16px);' +
    'font-size:var(--wa-font-size-s, 0.9rem);color:var(--wa-label-color, #555);';

  const label = document.createElement('label');
  label.htmlFor = 'theme-select';
  label.textContent = 'Theme';

  const select = document.createElement('select');
  select.id = 'theme-select';
  select.style.cssText =
    'font-family:inherit;font-size:inherit;padding:var(--wa-padding-s, 6px);' +
    'border-radius:var(--wa-border-radius-m, 4px);' +
    'border:1px solid var(--wa-input-border-color, #ccc);' +
    'background:var(--wa-input-background-color, #fff);' +
    'color:var(--wa-input-text-color, #333);';

  for (const theme of listThemes()) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.label;
    select.appendChild(option);
  }
  select.value = current;

  select.addEventListener('change', () => {
    if (isGalleryTheme(select.value)) onChange(select.value);
  });

  host.appendChild(label);
  host.appendChild(select);
}
