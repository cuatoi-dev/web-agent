/** Properties used by cat-store's Material text fields. */
export type MaterialField = HTMLElement & {
  value: string;
  placeholder: string;
  disabled: boolean;
  type: string;
  min: string;
  max: string;
  required: boolean;
  name: string;
  rows?: number;
  handleInput?: (event: Event) => void;
  updateComplete?: Promise<unknown>;
};

export interface MdMenuInternal extends HTMLElement {
  open: boolean;
  anchor: string;
  anchorElement: HTMLElement | null;
  menuPositionController?: {
    close?: () => void;
  };
  reposition?: () => void;
}
