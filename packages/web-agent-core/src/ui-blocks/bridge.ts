export function buttonToMessage(prompt: string): string {
  return `[ui_action:button] ${prompt}`;
}

export function formSubmitToMessage(id: string, values: Record<string, unknown>): string {
  return `[ui_action:form_submit id=${id}]\n${JSON.stringify(values, null, 2)}`;
}

export function isInteractive(messageIndex: number, latestIndex: number, running: boolean): boolean {
  if (running) return false;
  return messageIndex === latestIndex;
}
