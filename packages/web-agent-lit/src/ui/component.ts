import { render } from "./template.js";

export abstract class Component extends HTMLElement {
  private _dirty = false;
  private _updatePromise: Promise<boolean> | null = null;
  private _resolveUpdate: ((v: boolean) => void) | null = null;

  constructor() {
    super();
  }

  connectedCallback() {
    this.requestUpdate();
  }

  abstract template(): unknown;

  requestUpdate() {
    if (this._dirty) {
      return;
    }
    this._dirty = true;
    if (!this._updatePromise) {
      this._updatePromise = new Promise((resolve) => {
        this._resolveUpdate = resolve;
      });
    }
    queueMicrotask(() => {
      this._performUpdate();
    });
  }

  private _performUpdate() {
    if (!this._dirty) return;
    if (typeof document === "undefined" || !this.isConnected) {
      this._dirty = false;
      const resolve = this._resolveUpdate;
      this._updatePromise = null;
      this._resolveUpdate = null;
      if (resolve) {
        resolve(false);
      }
      return;
    }
    this._dirty = false;
    const resolve = this._resolveUpdate;
    this._updatePromise = null;
    this._resolveUpdate = null;
    try {
      this.willUpdate();
      const t = this.template();
      if (t) {
        render(t, this);
      }
      this.updated();
    } finally {
      if (resolve) {
        resolve(true);
      }
    }
  }

  willUpdate() {}

  updated() {}

  get renderRoot() {
    return this;
  }

  get updateComplete(): Promise<boolean> {
    if (this._updatePromise) {
      return this._updatePromise;
    }
    return Promise.resolve(true);
  }
}

