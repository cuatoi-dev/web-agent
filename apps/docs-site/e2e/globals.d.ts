// Marker properties the e2e specs set inside page.evaluate to detect full page
// reloads and app re-instantiation. Declared once here so no spec needs a cast.
export {};

declare global {
  interface Window {
    /** routing.mock.spec.ts — survives a hash navigation, not a reload. */
    __noReloadMarker?: string;
    /** navigation-session.mock.spec.ts — same idea, its own name. */
    __noReloadSentinel?: string;
    /** routing.mock.spec.ts — set by a <script> tag that sanitization must strip.
     *  Stays undefined when sanitization works. */
    malicious?: boolean;
  }
}

// __instanceMarker / __instanceMark are set on the bubble element itself (not
// window) to prove the same JS instance survives a route change, so they
// augment WebAgentBubble rather than Window.
declare module "@cuatoi/web-agent-lit" {
  interface WebAgentBubble {
    /** routing.mock.spec.ts — identity of the current bubble instance. */
    __instanceMarker?: string;
    /** navigation-session.mock.spec.ts — same idea, its own name. */
    __instanceMark?: string;
  }
}
