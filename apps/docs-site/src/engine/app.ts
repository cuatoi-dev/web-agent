import { LitElement, customElement, property } from 'lit-element';
import { html } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { IndexEntry } from './types';
import { applyTheme } from '@cuatoi/web-agent-lit/themes';

applyTheme(document.documentElement, 'wa2-light');

const DEFAULT_CAT = 'guides';
const DEFAULT_SLUG = 'index';

function stripFrontmatter(text: string): string {
  // Remove a leading YAML frontmatter block (--- ... ---) so it is never
  // rendered as visible body text.
  const m = text.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? text.slice(m[0].length) : text;
}

function sanitizeMd(text: string): string {
  try {
    const raw = marked.parse(stripFrontmatter(text)) as string;
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['dialog', 'menu'],
      ADD_ATTR: ['data-ui', 'open', 'target'],
      FORBID_TAGS: ['script', 'style'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    });
  } catch {
    return text;
  }
}

function getIconForSlug(slug: string): string {
  const icons: Record<string, string> = {
    'index': 'home',
    'registry': 'extension',
    'lit3-registry': 'bolt',
    'lit-html-binding': 'electrical_services',
    'architecture': 'schema',
    'tools': 'build',
    'embedding': 'code',
    'theming': 'palette',
    'troubleshooting': 'bug_report',
    'usage': 'play_arrow',
    'showcase': 'widgets',
  };
  return icons[slug] || 'article';
}

@customElement('docs-app')
export class DocsApp extends LitElement {
  @property({ type: Array }) private _index: IndexEntry[] = [];
  @property({ type: String }) private _activeCategory = '';
  @property({ type: String }) private _activeSlug = '';
  @property({ type: String }) private _contentHtml = '';
  @property({ type: Boolean }) private _loading = false;
  @property({ type: String }) private _error = '';
  private _boundOnRoute = () => this._onRoute();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('hashchange', this._boundOnRoute);
    if (this._index.length === 0) {
      void this._fetchIndex();
    } else {
      this._onRoute();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this._boundOnRoute);
  }

  private async _fetchIndex() {
    try {
      const res = await fetch('md-index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this._index = (await res.json()) as IndexEntry[];
    } catch {
      this._error = 'Failed to load index';
    }
    this._onRoute();
  }

  private _onRoute() {
    this._closeDrawerIfOpen();
    const hash = location.hash; // e.g. '#/guides/tools'
    let cat = DEFAULT_CAT;
    let slug = DEFAULT_SLUG;

    if (hash && hash !== '#/' && hash !== '#') {
      const stripped = hash.startsWith('#/') ? hash.slice(2) : hash.slice(1);
      const parts = stripped.split('/');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const candidateCat = parts[0];
        // `#/lit/some-guide#2-section` is one page with a section fragment —
        // the fragment is not part of the slug.
        const [slugOnly] = parts[1].split('#');
        const candidateSlug = slugOnly || parts[1];
        if (this._folders().includes(candidateCat)) {
          const exists = this._index.some(
            e => e.folder === candidateCat && e.slug === candidateSlug
          );
          if (!exists) {
            // Known category, unknown page. Report it instead of silently
            // falling back to the category's first page — and do not fetch, so
            // the browser console stays clean of an expected 404.
            this._loading = false;
            this._activeCategory = candidateCat;
            this._activeSlug = candidateSlug;
            this._contentHtml = '';
            this._error = `Content not found: ${candidateCat}/${candidateSlug}`;
            return;
          }
          cat = candidateCat;
          slug = candidateSlug;
        }
      } else if (parts.length === 1 && parts[0]) {
        // Single-segment: treat as category shortcut
        const candidateCat = parts[0];
        if (this._folders().includes(candidateCat)) {
          cat = candidateCat;
          slug = this._defaultSlugForCat(candidateCat);
        }
        // else fallback stays as default
      }
    } else {
      // Default: lowest-order Guides entry
      const first = this._firstInCat('guides');
      if (first) { cat = 'guides'; slug = first.slug; }
    }

    void this._loadContent(cat, slug);
  }

  // Beer CSS only closes #sidebar via a click on a [data-ui="#sidebar"]
  // element (see vendored beer.js onClickDataUi/updateAllDataUis — there is
  // no hashchange/popstate listener anywhere in it). Any route change that
  // doesn't go through that click path (e.g. the always-visible header's
  // Overview/Showcase links, which carry no data-ui) leaves the drawer stuck
  // open. Force-close it here on every route change, via Beer's own public
  // toggle API, so the fix covers every navigation path, not just
  // drawer-internal links.
  private _closeDrawerIfOpen() {
    const dialog = this.querySelector<HTMLDialogElement>('#sidebar');
    if (!dialog) return;
    const isOpen = dialog.classList.contains('active') || dialog.open;
    if (!isOpen) return;
    (globalThis as { ui?: (selector: string) => unknown }).ui?.('#sidebar');
  }

  // Beer CSS's data-ui="#sidebar" intercepts the click to close the drawer and
  // preventDefaults the anchor, so the #/... href never navigates. Force the
  // hash route ourselves; the drawer still closes via data-ui.
  private _onDrawerNav = (ev: Event) => {
    const href = (ev.currentTarget as HTMLElement)?.getAttribute('href');
    if (href) location.hash = href;
  };

  private _defaultSlugForCat(cat: string): string {
    const first = this._firstInCat(cat);
    return first ? first.slug : DEFAULT_SLUG;
  }

  private _firstInCat(folder: string): IndexEntry | undefined {
    return this._index
      .filter(e => e.folder === folder)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))[0];
  }

  private _folders(): string[] {
    return [...new Set(this._index.map(e => e.folder))];       // nav order = index order
  }

  private _sections(): { category: string; folder: string; entries: IndexEntry[] }[] {
    const out: { category: string; folder: string; entries: IndexEntry[] }[] = [];
    for (const e of this._index) {                             // index is already sorted
      const last = out[out.length - 1];
      if (last && last.category === e.category) last.entries.push(e);
      else out.push({ category: e.category, folder: e.folder, entries: [e] });
    }
    return out;
  }

  private async _loadContent(cat: string, slug: string) {
    this._loading = true;
    this._error = '';
    this._activeCategory = cat;
    this._activeSlug = slug;

    try {
      const res = await fetch(`content/${cat}/${slug}.md`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      this._contentHtml = sanitizeMd(text);
    } catch {
      this._error = `Content not found: ${cat}/${slug}`;
      this._contentHtml = '';
    }

    this._loading = false;
    window.scrollTo(0, 0);
  }

  render() {
    const sections = this._sections();

    return html`
      <!-- Sidebar Drawer for responsive mobile navigation -->
      <dialog id="sidebar" class="left drawer">
        <nav class="drawer">
          <header>
            <h5 class="max">Navigation</h5>
            <button class="circle flat" data-ui="#sidebar">
              <i>close</i>
            </button>
          </header>
          ${sections.map(s => html`
            <div class="nav-section-label">${s.category}</div>
            ${s.entries.map(e => html`
              <a
                href="#/${s.folder}/${e.slug}"
                class="row nav-link${this._activeCategory === s.folder && this._activeSlug === e.slug ? ' active' : ''}"
                data-ui="#sidebar"
                @click=${this._onDrawerNav}
              >
                <i>${s.folder === 'beercss' ? 'palette' : getIconForSlug(e.slug)}</i>
                <span>${e.title}</span>
              </a>
            `)}
          `)}
        </nav>
      </dialog>

      <div class="content-wrapper">
        <nav class="side-nav" aria-label="Documentation navigation">
          ${sections.map(s => s.folder === 'guides'
            ? html`
              <div class="nav-section-label">${s.category}</div>
              ${s.entries.map(e => html`
                <a
                  href="#/guides/${e.slug}"
                  class="nav-link${this._activeCategory === 'guides' && this._activeSlug === e.slug ? ' active' : ''}"
                >
                  <i>${getIconForSlug(e.slug)}</i>
                  <span>${e.title}</span>
                </a>
              `)}`
            : html`
              <details class="nav-details" ?open=${this._activeCategory === s.folder}>
                <summary class="nav-section-label nav-summary">${s.category}</summary>
                ${s.entries.map(e => html`
                  <a
                    href="#/${s.folder}/${e.slug}"
                    class="nav-link${this._activeCategory === s.folder && this._activeSlug === e.slug ? ' active' : ''}"
                  >
                    <i>${s.folder === 'beercss' ? 'palette' : getIconForSlug(e.slug)}</i>
                    <span>${e.title}</span>
                  </a>
                `)}
              </details>`)}
        </nav>
        <main class="page-content">
          ${this._loading
            ? html`<p class="secondary-text">Loading…</p>`
            : this._error
            ? html`<p class="error-text">${this._error}</p>`
            : html`<article data-cat="${this._activeCategory}" data-slug="${this._activeSlug}">${unsafeHTML(this._contentHtml)}</article>`
          }
        </main>
      </div>
    `;
  }
}
