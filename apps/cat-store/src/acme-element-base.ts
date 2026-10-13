/** Base for cat-store's Material-backed UI elements. */
export abstract class AcmeElement extends HTMLElement {
  protected _inner: HTMLElement | null = null;
  static get observedAttributes(): string[] { return []; }
  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    Reflect.set(this, name, value ?? "");
  }
  connectedCallback(): void {
    if (!this._inner) {
      this._inner = this.build();
      this.append(this._inner);
    }
    this.sync();
  }
  protected abstract build(): HTMLElement;
  protected abstract sync(): void;
  protected fire(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}
