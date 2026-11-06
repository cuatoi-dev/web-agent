export {};

/** Counter installed by `installDescribeCounter()` in e2e/helpers.ts to gate
 *  on the agent's describe fetches. */
interface DescribeCounter {
  issued: number;
  inFlight: number;
}

declare global {
  interface Window {
    __WA_E2E_DESCRIBE__?: DescribeCounter;
    /** The `messages` array the mock LLM's next call received, captured by
     *  genui-tool.mock.spec.ts to assert on the real image part the loop
     *  appends. The mock script itself is untyped (`opts: any`), so the
     *  captured value stays unknown[] rather than pretending to a shape the
     *  test does not check at this boundary. */
    __WA_GENUI_NEXT_CALL_MESSAGES__?: unknown[];
    /** The pending confirm-scrim decision promise; fenced-ui.mock.spec.ts
     *  reads the resolved boolean without touching a member. */
    __scrim?: unknown;
    /** Toast messages captured off the `agent-toast` DOM event. */
    __toasts?: string[];
    /** True when the panel had a host `notify` callback at probe time (008). */
    __hadNotify?: boolean;
    /** `snapshot_page` tool-result text captured by the shadow-host mock
     *  script in fenced-ui.mock.spec.ts. */
    __SHADOW_HOST_SNAPSHOT__?: string;
    /** `click` tool-result text for the block-tier refusal, same script. */
    __SHADOW_HOST_BLOCK_RESULT__?: string;
    /** create-skill-no-owner.mock.spec.ts (120/004): the create_skill
     *  input_schema from the first model call's tool list. */
    __CAT_CREATE_SKILL_SCHEMA__?: Record<string, unknown> | null;
    /** attach-folder.mock.spec.ts and memory-loader.mock.spec.ts: the text of
     *  every user message the model received, in order. */
    __USER_TEXTS__?: string[];
  }
}
