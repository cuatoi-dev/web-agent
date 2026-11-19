import { expect } from "@playwright/test";

// page_screenshot and stop_recording return their own text first and
// the path they saved at on a final "Saved <path>" line. These read the two
// halves back apart so an existing assertion keeps its original shape.

/** The tool's own text, without the trailing "Saved <path>" line. */
export function captionOf(text: string): string {
  return text.split("\n")[0];
}

/** The report or caption of a multi-line result such as stop_recording. */
export function bodyOf(text: string): string {
  const i = text.lastIndexOf("\nSaved ");
  return i < 0 ? text : text.slice(0, i);
}

/** The saved path on the last line, or "" when there is none. */
export function savedPathOf(text: string): string {
  const i = text.lastIndexOf("\nSaved ");
  return i < 0 ? "" : text.slice(i + "\nSaved ".length);
}

export const SAVED_PNG_PATH = /^\/tmp\/screenshots\/\d{4}-\d{2}-\d{2}-\d{6}-tab\d+\.png$/;
export const SAVED_RECORDING_PATH = /^\/tmp\/recordings\/\d{4}-\d{2}-\d{2}-\d{6}\.md$/;

/** Asserts the result ends with a saved default PNG path and returns it. */
export function expectSavedPng(text: string): string {
  const path = savedPathOf(text);
  expect(path).toMatch(SAVED_PNG_PATH);
  return path;
}

/** Asserts the result ends with a saved recording path and returns it. */
export function expectSavedRecording(text: string): string {
  const path = savedPathOf(text);
  expect(path).toMatch(SAVED_RECORDING_PATH);
  return path;
}