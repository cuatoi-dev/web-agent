import { beforeEach, describe, expect, it } from 'vitest';
import { listThemes, registerTheme } from '@cuatoi/web-agent-lit/themes';
import { getShowcaseThemes, frameUrl } from './theme-showcase-data';

/** A theme registered mid-test, after the data module was imported. */
const FIXTURE = {
  id: 'fixture-gallery',
  label: 'Fixture gallery',
  scheme: 'light' as const,
  base: 'wa2-light',
};

describe('theme showcase data', () => {
  let themes: ReturnType<typeof getShowcaseThemes>;

  beforeEach(() => {
    themes = getShowcaseThemes();
  });

  it('lists every registered theme then the host-provided example', () => {
    expect(themes).toEqual([
      ...listThemes().map(({ id, label }) => ({ id, label })),
      { id: 'provided', label: 'Host-provided (wa2-light + custom info/border)' },
    ]);
    expect(themes.at(-1)?.id).toBe('provided');
    expect(themes.filter((t) => t.id === 'provided')).toHaveLength(1);
  });

  it('finds a theme registered after the module was imported', () => {
    registerTheme(FIXTURE);
    const after = getShowcaseThemes();
    expect(after.map((t) => t.id)).toEqual([...listThemes().map((t) => t.id), 'provided']);
    expect(after.at(-2)).toEqual({ id: FIXTURE.id, label: FIXTURE.label });
  });

  it('frameUrl requests the showcase frame for the given theme', () => {
    for (const theme of themes) {
      const url = new URL(frameUrl(theme.id), 'http://localhost/gallery.html');
      expect(url.searchParams.get('frame')).toBe('demo-theme-showcase');
      expect(url.searchParams.get('showcase')).toBe('1');
      expect(url.searchParams.get('theme')).toBe(theme.id);
    }
  });
});