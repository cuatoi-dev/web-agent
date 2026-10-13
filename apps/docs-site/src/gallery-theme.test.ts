// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// The helper and the registry are imported together after `vi.resetModules()`
// so both sides share one fresh registry instance per test. Importing either
// statically would pin the module graph before the reset.
let registry: typeof import('@cuatoi/web-agent-lit/themes');
let gallery: typeof import('./gallery-theme');

/** The docs-site gallery default. */
const DEFAULT_THEME = 'wa2-light';

/** A theme registered mid-test, after the gallery module was imported. */
const FIXTURE = {
  id: 'fixture-gallery',
  label: 'Fixture gallery',
  scheme: 'light' as const,
  base: 'wa2-light',
};

/** Undo what a registry application leaves on the document. */
function clearThemeArtifacts(): void {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-theme-base');
  for (const node of Array.from(document.head.querySelectorAll('[data-wa-theme-css]'))) {
    node.remove();
  }
}

beforeEach(async () => {
  vi.resetModules();
  registry = await import('@cuatoi/web-agent-lit/themes');
  gallery = await import('./gallery-theme');
});

afterEach(() => {
  clearThemeArtifacts();
  vi.restoreAllMocks();
});

describe('docs-site gallery theme switcher', () => {
  it('isGalleryTheme accepts every registered theme', () => {
    for (const t of registry.listThemes()) {
      expect(gallery.isGalleryTheme(t.id)).toBe(true);
    }
  });

  it('isGalleryTheme rejects unregistered values', () => {
    expect(gallery.isGalleryTheme('wa1-light')).toBe(false);
    expect(gallery.isGalleryTheme('no-such-theme')).toBe(false);
    expect(gallery.isGalleryTheme('dark')).toBe(false);
    expect(gallery.isGalleryTheme('')).toBe(false);
    expect(gallery.isGalleryTheme(null)).toBe(false);
  });

  it('resolveTheme reads ?theme= from the query string', () => {
    expect(gallery.resolveTheme('?theme=wa1-dark', DEFAULT_THEME)).toBe('wa1-dark');
  });

  it('resolveTheme resolves every registered id from the query string', () => {
    for (const t of registry.listThemes()) {
      expect(gallery.resolveTheme(`?theme=${t.id}`, 'no-such-theme')).toBe(t.id);
    }
  });

  it('resolveTheme falls back to the docs-site default for unknown and empty values', () => {
    expect(gallery.resolveTheme('?theme=bogus', DEFAULT_THEME)).toBe(DEFAULT_THEME);
    expect(gallery.resolveTheme('?theme=', DEFAULT_THEME)).toBe(DEFAULT_THEME);
  });

  it('resolveTheme falls back when theme is absent', () => {
    expect(gallery.resolveTheme('', DEFAULT_THEME)).toBe(DEFAULT_THEME);
  });

  it('resolveTheme finds theme even when not the first param', () => {
    expect(gallery.resolveTheme('?frame=empty&vp=desktop&theme=wa2-dark', DEFAULT_THEME)).toBe('wa2-dark');
  });

  it('applyTheme sets data-theme on the document root', () => {
    gallery.applyTheme('wa1-dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('wa1-dark');
    expect(document.documentElement.hasAttribute('data-theme-base')).toBe(false);
  });

  it('mountThemeSwitcher lists the registry in order and fires onChange once', () => {
    const host = document.createElement('div');
    const cb = vi.fn();
    gallery.mountThemeSwitcher(host, DEFAULT_THEME, cb);

    const options = host.querySelectorAll('option');
    expect(Array.from(options, (o) => [o.value, o.textContent])).toEqual(
      registry.listThemes().map(({ id, label }) => [id, label]),
    );
    const select = host.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe(DEFAULT_THEME);

    select.value = 'wa1-dark';
    select.dispatchEvent(new Event('change'));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('wa1-dark');
  });

  it('lists a theme registered after the helper was imported', () => {
    registry.registerTheme(FIXTURE);
    const host = document.createElement('div');
    const cb = vi.fn();
    gallery.mountThemeSwitcher(host, DEFAULT_THEME, cb);

    const options = Array.from(host.querySelectorAll('option'), (o) => [o.value, o.textContent]);
    expect(options).toHaveLength(registry.listThemes().length);
    expect(options).toContainEqual([FIXTURE.id, FIXTURE.label]);
    expect(options.at(-1)).toEqual([FIXTURE.id, FIXTURE.label]);

    expect(gallery.isGalleryTheme(FIXTURE.id)).toBe(true);
    expect(gallery.resolveTheme(`?theme=${FIXTURE.id}`, DEFAULT_THEME)).toBe(FIXTURE.id);

    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = FIXTURE.id;
    select.dispatchEvent(new Event('change'));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(FIXTURE.id);
  });

  it('applying a registered custom theme sets both root attributes', () => {
    registry.registerTheme(FIXTURE);
    gallery.applyTheme(FIXTURE.id);
    expect(document.documentElement.getAttribute('data-theme')).toBe(FIXTURE.id);
    expect(document.documentElement.getAttribute('data-theme-base')).toBe(FIXTURE.base);

    gallery.applyTheme(DEFAULT_THEME);
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME);
    expect(document.documentElement.hasAttribute('data-theme-base')).toBe(false);
  });

  it('applying an unknown theme leaves the root unchanged and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gallery.applyTheme(DEFAULT_THEME);
    document.documentElement.setAttribute('data-theme-base', 'wa2-dark');

    gallery.applyTheme('no-such-theme');

    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME);
    expect(document.documentElement.getAttribute('data-theme-base')).toBe('wa2-dark');
    expect(warn).toHaveBeenCalledWith('[web-agent] unknown theme: no-such-theme');
  });

  it('a change event with an unregistered value does not call the callback', () => {
    const host = document.createElement('div');
    const cb = vi.fn();
    gallery.mountThemeSwitcher(host, DEFAULT_THEME, cb);

    const select = host.querySelector('select') as HTMLSelectElement;
    const option = document.createElement('option');
    option.value = 'not-registered';
    option.textContent = 'Not registered';
    select.appendChild(option);

    select.value = 'not-registered';
    select.dispatchEvent(new Event('change'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('mountThemeSwitcher with null host is a no-op', () => {
    const before = document.documentElement.getAttribute('data-theme');
    expect(() => gallery.mountThemeSwitcher(null, 'wa1-dark', vi.fn())).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe(before);
  });

  it('never writes localStorage (the docs gallery keeps no theme preference)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const host = document.createElement('div');
    const cb = vi.fn();
    gallery.mountThemeSwitcher(host, DEFAULT_THEME, cb);
    gallery.applyTheme('wa1-dark');
    const select = host.querySelector('select') as HTMLSelectElement;
    select.value = 'wa2-dark';
    select.dispatchEvent(new Event('change'));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });
});