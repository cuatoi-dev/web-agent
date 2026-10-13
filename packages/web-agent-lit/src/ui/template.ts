// Seam — all UI code imports lit-html through this path.
// lit-html is a peer dependency supplied by the host; not vendored.
export { html, svg, render, nothing } from "lit-html";
export { unsafeHTML } from "lit-html/directives/unsafe-html.js";
export { live } from "lit-html/directives/live.js";
export { repeat } from "lit-html/directives/repeat.js";
