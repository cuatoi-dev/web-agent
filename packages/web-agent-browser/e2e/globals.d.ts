// Marker properties the e2e specs set inside page.evaluate / addInitScript to
// hand a result out of the page realm. Declared once here so no spec needs a
// cast. Only tsconfig.lint.json includes e2e/**, so these never enter the
// production program.
export {};

declare global {
  interface Window {
    /** page-agent.mock.spec.ts, "read_page_agent rejects an invalid wait
     *  value": the tool's own output plus its isError verdict. */
    __BAD_WAIT_RESULT__?: { result: string; isError: boolean };
    /** page-eval.mock.spec.ts, "a result longer than the cap is truncated":
     *  a long string the order-console fixture sets on load. */
    __BIG_TEXT__?: string;
    /** page-tools.mock.spec.ts, "data-agent-permission='block'": the last
     *  message, stringified, at the point the blocked action was reported. */
    __BLOCKED_RESULT__?: string;
    /** act-by-ref.mock.spec.ts, "page_click on Place order": the page_click
     *  tool's output text for the describe/execute round trip. */
    __CLICK_RESULT__?: string;
    /** act-by-ref.mock.spec.ts, "page_fill_form with one valid ref and one
     *  stale ref": the ref for the Coupon field, read off the first
     *  page_snapshot's output text. */
    __COUPON_REF__?: string;
    /** skills.mock.spec.ts: the create_skill tool's output text. */
    __CREATE_SKILL_RESULT__?: string;
    /** act-by-ref.mock.spec.ts and debugger-session.mock.spec.ts: set once the
     *  mock model has asked for start_debugging, so it is asked only once. */
    __DEBUG_STARTED__?: boolean;
    /** page-agent.mock.spec.ts, "002 — send_to_page_agent reports not
     *  delivered after the page removes the bubble": the send tool's output
     *  plus its isError verdict, against detaching-agent.html. */
    __DETACHED_SEND_RESULT__?: { sendResult: string; isError: boolean };
    /** page-agent.mock.spec.ts, "002 — the toggle mounts on the first press
     *  after the page removed the bubble": the toggle tool's output plus its
     *  isError verdict, against detaching-agent.html. */
    __DETACHED_TOGGLE_RESULT__?: { toggleResult: string; isError: boolean };
    /** act-by-ref.mock.spec.ts, "page_fill_form with one valid ref and one
     *  stale ref": the ref for the Email field, read off the first
     *  page_snapshot's output text. */
    __EMAIL_REF__?: string;
    /** human-events.demo.spec.ts: the fixture's recorded event order, read
     *  back as a list of log lines. */
    __EVENT_ORDER__?: () => string[];
    /** act-by-ref.mock.spec.ts, "page_select_option": the ref for the Extras
     *  `<select multiple>`, read off page_snapshot's output text. */
    __EXTRAS_REF__?: string;
    /** act-by-ref.mock.spec.ts, "page_select_option": the page_select_option
     *  tool's output text for the ["Gift wrap", "Card"] multi-select call. */
    __EXTRAS_RESULT__?: string;
    /** act-by-ref.mock.spec.ts, "page_fill_form with one valid ref and one
     *  stale ref": the page_fill_form tool's output text for the call that
     *  mixes a valid and a stale ref. */
    __FILL_RESULT__?: string;
    /** page-agent.mock.spec.ts, "toggle_page_agent on nested-agent.html":
     *  the toggle tool's output plus its isError verdict, against a page
     *  that already has its own agent. */
    __FOREIGN_RESULT__?: { toggleResult: string; isError: boolean };
    /** page-fetch.mock.spec.ts, "non-2xx response": whether the page_fetch
     *  tool call reported an error for the 404 response. */
    __LAST_404_IS_ERROR__?: boolean;
    /** page-fetch.mock.spec.ts, "non-2xx response": the page_fetch tool's
     *  output text for the 404 response. */
    __LAST_404_OUTPUT__?: string;
    /** page-fetch.mock.spec.ts, "cross-origin URL is blocked": whether the
     *  page_fetch tool call reported an error for the cross-origin request. */
    __LAST_CORS_IS_ERROR__?: boolean;
    /** page-fetch.mock.spec.ts, "cross-origin URL is blocked": the
     *  page_fetch tool's output text for the cross-origin request. */
    __LAST_CORS_OUTPUT__?: string;
    /** page-eval.mock.spec.ts: whether the last page_eval tool call reported
     *  an error. */
    __LAST_EVAL_IS_ERROR__?: boolean;
    /** page-eval.mock.spec.ts: the last page_eval tool call's output text. */
    __LAST_EVAL_OUTPUT__?: string;
    /** page-fetch.mock.spec.ts, "GET same-origin": the page_fetch tool's
     *  output text for the GET request. */
    __LAST_FETCH_OUTPUT__?: string;
    /** page-fetch.mock.spec.ts, "large response body": the page_fetch
     *  tool's output text, truncated at the tool's output ceiling. */
    __LAST_LARGE_OUTPUT__?: string;
    /** page-fetch.mock.spec.ts, "POST same-origin": the page_fetch tool's
     *  output text for the POST request. */
    __LAST_POST_OUTPUT__?: string;
    /** page-tools.mock.spec.ts, "snapshot_page extracts document content":
     *  the snapshot_page tool's output text. */
    __LAST_SNAPSHOT__?: string;
    /** skills.mock.spec.ts and brand-skills.mock.spec.ts (120/005 E13): the
     *  load_skill tool's output text. */
    __LOAD_SKILL_RESULT__?: string;
    /** act-by-ref.mock.spec.ts, "a non-activated tab returns the
     *  NOT_ACTIVATED text": the page_snapshot tool's output text against an
     *  un-activated tab. */
    __NOT_ACTIVATED_RESULT__?: string;
    /** page-script-tools.mock.spec.ts: whether `page-eval-cdp.html`'s own
     *  `new Function` was refused by the page's CSP at load — the control
     *  that proves the CSP is really in force for the page's own code, while
     *  page_eval's CDP-based `Runtime.evaluate` is unaffected by it. */
    __NEW_FUNCTION_BLOCKED__?: boolean;
    /** skills.mock.spec.ts, 120/004 owner tests: the `create_skill`
     *  input_schema in the tool list of the first model call, or null when
     *  the tool was not offered. */
    __OWNER_CREATE_SCHEMA__?: Record<string, unknown> | null;
    /** skills.mock.spec.ts, 120/004 owner tests: the scripted tool call's
     *  output text and its isError flag. */
    __OWNER_TOOL_RESULT__?: { text: string; isError: boolean };
    /** relay.demo.spec.ts: a marker set before an in-page action, read back
     *  afterwards to prove no full page reload happened on react.dev. */
    __REACT_DEV_MARKER__?: boolean;
    /** page-agent.mock.spec.ts, "read_page_agent reads back the bubble's
     *  conversation": the read_page_agent tool's output text. */
    __READ_RESULT__?: string;
    /** sidepanel.mock.spec.ts, "read_tabs execution": the read_tabs tool's
     *  output text. */
    __READ_TABS_RESULT__?: string;
    /** page-tools.mock.spec.ts, "click triggers action cue": whether the
     *  fixture page's own click listener fired. */
    __SEARCH_CLICKED__?: boolean;
    /** sidepanel.mock.spec.ts, "tab_management skill is discoverable", and
     *  brand-skills.mock.spec.ts (120/005 E10-E12, E14): the search_skills
     *  tool's output text. */
    __SEARCH_SKILLS_RESULT__?: string;
    /** page-agent.mock.spec.ts, "toggle_page_agent twice toggles OFF": the
     *  second toggle_page_agent tool call's output text. */
    __SECOND_TOGGLE_RESULT__?: string;
    /** page-agent.mock.spec.ts, "send_to_page_agent re-opens a bubble the user
     *  opened and then closed": the send tool's output plus its isError
     *  verdict, after the bubble was opened and closed by hand. */
    __SEND_AFTER_CLOSE_RESULT__?: { sendResult: string; isError: boolean };
    /** page-agent.mock.spec.ts, "send_to_page_agent against a tab where the
     *  bubble is off": the send tool's output plus its isError verdict. */
    __SEND_OFF_RESULT__?: { sendResult: string; isError: boolean };
    /** page-agent.mock.spec.ts, "toggle_page_agent turns bubble ON": the
     *  send_to_page_agent tool's output text. */
    __SEND_RESULT__?: string;
    /** act-by-ref.mock.spec.ts, "page_select_option": the ref for the
     *  Shipping single-choice `<select>`, read off page_snapshot's output
     *  text. */
    __SHIPPING_REF__?: string;
    /** act-by-ref.mock.spec.ts, "page_select_option": the page_select_option
     *  tool's output text for the two-value call against the single-choice
     *  Shipping select. */
    __SHIPPING_RESULT__?: string;
    /** page-tools.mock.spec.ts, "client-side SPA navigation", first
     *  snapshot_page result, taken before the route change. */
    __SNAPSHOT_GEN1__?: string;
    /** page-tools.mock.spec.ts, "client-side SPA navigation", second
     *  snapshot_page result, taken after the route change. */
    __SNAPSHOT_GEN2__?: string;
    /** page-tools.mock.spec.ts, "client-side SPA navigation": a marker set
     *  before the SPA route change, read back to prove no full reload
     *  happened. */
    __SPA_MARKER__?: boolean;
    /** page-eval.demo.spec.ts: the order-console fixture page's live state
     *  (`e2e/fixtures/page-eval.html`, `e2e/fixtures/page-eval-csp.html`). Not
     *  a marker the extension sets — a global the fixture page itself
     *  defines, read directly by the live-proof spec to confirm the tool's
     *  answer independently of the model. */
    __STORE_STATE__?: { pendingOrders: number; currency: string; cartTotal: number; region: string };
    /** page-agent.mock.spec.ts, "page-agent tools against extension sidepanel
     *  tab" and "read_page_agent rejects an invalid wait value": the tab id
     *  the mock script's tool call should target, written by the spec before
     *  the turn starts because the side panel's own tab id isn't otherwise
     *  reachable from inside the mock script closure. */
    __TARGET_TAB_ID__?: number;
    /** page-agent.mock.spec.ts, "toggle_page_agent turns bubble ON": the
     *  first toggle_page_agent tool call's output text. */
    __TOGGLE_RESULT__?: string;
    /** page-agent.mock.spec.ts, "page-agent tools against extension sidepanel
     *  tab": the toggle tool's output plus its isError verdict, against the
     *  extension's own sidepanel tab. */
    __UNREACHABLE_RESULT__?: { result: string; isError: boolean };
    /** verify-locator.mock.spec.ts: every page_verify and page_generate_locator
     *  result in call order, with the tool name and its isError flag. */
    __VERIFY_RESULTS__?: { tool: string; text: string; isError: boolean }[];
    /** attach-folder.mock.spec.ts: the folder name the stand-in
     *  `showDirectoryPicker` returns from the origin-private root next, or
     *  "__abort__" to throw an AbortError. */
    __PICK_NEXT__?: string;
    /** Permission calls and whether they run inside a user gesture. */
    __PERM_CALLS__?: { kind: "query" | "request"; mode: string; active: boolean }[];
    /** attach-folder.mock.spec.ts: the options each stand-in picker call got. */
    __PICKER_CALLS__?: { mode?: string }[];
    /** network-dialog.mock.spec.ts, debugger-session.mock.spec.ts,
     *  debugger-tools-002.mock.spec.ts and ref-tools-131.mock.spec.ts: the
     *  scripted tool-call queue the mock model works through, one call per turn. */
    __PLAN__?: { name: string; input: Record<string, unknown> }[];
    /** network-dialog.mock.spec.ts, debugger-session.mock.spec.ts,
     *  debugger-tools-002.mock.spec.ts and ref-tools-131.mock.spec.ts: every
     *  tool result in call order, with the tool name and its isError flag. */
    __TOOL_RESULTS__?: { tool: string; text: string; isError: boolean }[];
    /** debugger-tools-002.mock.spec.ts: toolCallIds already harvested into
     *  __TOOL_RESULTS__, so a page_screenshot success (whose image is injected
     *  as a separate user message on the next call, per core's tool-image loop)
     *  is not re-recorded when its tool-result message is no longer last. */
    __SEEN_TOOL_IDS__?: Set<string>;
    /** debugger-tools-002.mock.spec.ts: how many loop-injected
     *  image content parts the mock model has seen across the run, proving a
     *  successful page_screenshot's image actually reached the model. */
    __IMAGE_INJECTIONS__?: number;
    /** attach-folder.mock.spec.ts: whether to answer the first call slowly to test
     *  sending while the agent is running. */
    __SLOW_ONCE__?: boolean;
    /** attach-folder.mock.spec.ts and attach-folder.demo.spec.ts: the text of
     *  every user message the model received, in order. */
    __USER_TEXTS__?: string[];
    /** Mock-model hook the side panel reads in E2E_ENV=mock: a function the
     *  spec installs to script the model's turns. */
    __WA_MOCK_SCRIPT__?: (opts: { messages: { content: unknown }[]; tools?: { name: string }[] }) => unknown;
    /** theme.mock.spec.ts: a marker set after the theme is first applied,
     *  read back after a media-query flip to prove no reload happened. */
    __WA_NO_RELOAD__?: boolean;
    /** theme.demo.spec.ts: a marker set before an internal route change or
     *  media-query flip, read back afterwards to prove no full page reload
     *  happened. */
    __WA_ROUTE_MARKER__?: boolean;
    /** todo-tools.mock.spec.ts: the todo_read tool's output text. */
    __WA_TODO_READ_RESULT__?: string;
    /** todo-tools.mock.spec.ts: the second todo_write call's output text —
     *  the one that patches a single item by id. */
    __WA_TODO_PATCH_RESULT__?: string;
    /** todo-tools.mock.spec.ts: the first todo_write call's output text —
     *  the one that sets the three-item plan. */
    __WA_TODO_WRITE_RESULT__?: string;
    /** skills.mock.spec.ts, both "create_skill is offered" cases,
     *  todo-tools.mock.spec.ts, both "is offered" cases, and the
     *  brand-skills.mock.spec.ts tool-listing cases: the tool names in the
     *  list the provider was called with. */
    __WA_TOOLS__?: string[];
    /** page-eval.demo.spec.ts: the order-console fixture page's own
     *  shipping-estimate function, called directly to confirm the tool's
     *  answer independently of the model. */
    getShippingEstimate?: (region: string) => number;
  }

  // __T__ is set on `globalThis` (not `window`) by
  // `src/lib/page-eval-tool.test.ts` and `src/core/run-eval.test.ts`, `src/**`
  // files also covered by this program via tsconfig.lint.json's combined
  // include. A `var` in this `declare global` block applies to `globalThis` in
  // every realm the program type-checks (page window, service worker), unlike
  // a `Window` interface member.
  /** page-eval-tool.test.ts and run-eval.test.ts, "the default runner sees a
   *  global": a scratch global the test sets, then reads back through the
   *  default runner to prove that runner uses the real realm. */
  var __T__: number | undefined;

  /** sidepanel.demo.spec.ts: a counter the live-proof spec increments from
   *  the service worker's own `chrome.runtime.onConnect` listener, to prove
   *  a direct network turn opens no `wa-llm-relay` port. */
  var __relayConnectCount: number | undefined;

  /** skills.mock.spec.ts, "one write per save": a counter incremented from the
   *  service worker's own `chrome.storage.onChanged` listener, to prove one
   *  create_skill save produces exactly one `chrome.storage.local` write. */
  var __skillWrites: number | undefined;
}
