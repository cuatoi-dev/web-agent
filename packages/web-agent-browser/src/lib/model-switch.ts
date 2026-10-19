import type { ModelOption } from "@cuatoi/web-agent-core";
import type { ModelSwitch, ModelSwitchOptions, PublicModel } from "./types";

/** The cancelable event the kebab menu fires (web-agent-lit chat-panel.ts:186-197). */
export const MODEL_SELECT_EVENT = "agent-model-select";

export function toModelOptions(models: PublicModel[]): ModelOption[] {
  return models.map((m) => ({ id: m.ref, label: m.label, icon: m.icon }));
}

/** Puts one model on a bubble or a side panel, and switches it when the user
 *  picks another in the kebab menu (136/005). A switch writes path, type,
 *  model, imageInput and selectedModel; the panel keeps the conversation
 *  (core controller.ts:262-288). The tool providers are rebuilt only when
 *  the vision flag changes. Call before the element is connected. */
export function createModelSwitch(opts: ModelSwitchOptions): ModelSwitch {
  const { target, models, mock, buildToolProviders } = opts;
  let current: PublicModel | null = null;

  const apply = (ref: string): void => {
    // An unknown ref on the first apply opens on the first model; later, it
    // changes nothing.
    const next = models.find((m) => m.ref === ref) ?? (current === null ? models[0] : undefined);
    if (!next) return;
    target.path = next.endpoint;
    if (!mock) target.type = next.wireFormat;
    target.model = next.model;
    target.imageInput = next.vision;
    target.selectedModel = next.ref;
    if (current === null || current.vision !== next.vision) {
      target.toolProviders = buildToolProviders(next.vision);
    }
    current = next;
  };

  target.models = toModelOptions(models);
  apply(opts.initial);
  target.addEventListener(MODEL_SELECT_EVENT, (event) => {
    const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id !== "string") return;
    // The host decides: the panel must not swap only the model id.
    event.preventDefault();
    apply(id);
  });
  return { current: () => current?.ref ?? "" };
}
