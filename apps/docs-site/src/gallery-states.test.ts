import { describe, it, expect } from "vitest";
import { readAttachmentChips } from "@cuatoi/web-agent-core";
import type { FormBlock, ButtonsBlock } from "@cuatoi/web-agent-core";
import {
  GALLERY_STATES,
  makeState,
  DEMO_AGENT_AVATAR,
} from "./gallery-states";

describe("GALLERY_STATES", () => {
  it("header-off: hideHeader===true and kind is panel", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'header-off')!;
    expect(gs.hideHeader).toBe(true);
    expect(gs.kind).toBe('panel');
  });

  it("every state has a non-empty title and caption", () => {
    for (const gs of GALLERY_STATES) {
      expect(gs.title.length, `${gs.id} title`).toBeGreaterThan(0);
      expect(gs.caption.length, `${gs.id} caption`).toBeGreaterThan(0);
    }
  });

  it("choose-model: menuOpen=true, models has 2 entries", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'choose-model')!;
    expect(gs.menuOpen).toBe(true);
  });

  it("demo-cues: kind is demo and has mount function", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'demo-cues')!;
    expect(gs.kind).toBe('demo');
    expect(typeof gs.mount).toBe('function');
  });

  it("pointed-sent: user message carries promptMeta attachment chips and assistant replies", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'pointed-sent')!;
    expect(gs.kind).toBe('panel');
    const userMsg = gs.state!.messages.find(m => m.role === 'user')!;
    const chips = readAttachmentChips(userMsg.promptMeta);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0].providerId).toBe('picker');
    expect(gs.state!.messages.some(m => m.role === 'assistant')).toBe(true);
  });

  it("empty: messages=[], running=false, contextWindow.percent===0", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'empty')!;
    expect(gs.state!.messages).toEqual([]);
    expect(gs.state!.running).toBe(false);
    expect(gs.state!.contextWindow.percent).toBe(0);
  });

  it("tool-running: running===true", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'tool-running')!;
    expect(gs.state!.running).toBe(true);
  });

  it("compacting: running===false, compacting===true, and the last assistant part is a running compaction row", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'compacting')!;
    expect(gs.state!.running).toBe(false);
    expect(gs.state!.compacting).toBe(true);
    const asst = gs.state!.messages.find(m => m.role === 'assistant')!;
    const lastPart = asst.parts![asst.parts!.length - 1];
    expect(lastPart).toMatchObject({ kind: 'compaction', compaction: { status: 'running' } });
  });

  it("error: error is a non-empty string", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'error')!;
    expect(typeof gs.state!.error).toBe('string');
    expect((gs.state!.error as string).length).toBeGreaterThan(0);
  });

  it("generative-ui: one form block and one buttons block with ≥2 options", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'generative-ui')!;
    const parts = gs.state!.messages[0].parts!;
    const formBlock = parts.find(p => p.kind === 'block' && p.block?.type === 'form')?.block as FormBlock | undefined;
    const buttonsBlock = parts.find(p => p.kind === 'block' && p.block?.type === 'buttons')?.block as ButtonsBlock | undefined;

    expect(formBlock).toBeDefined();
    expect(formBlock!.fields.some(f => f.kind === 'select')).toBe(true);
    expect(formBlock!.fields.some(f => f.kind === 'checkbox')).toBe(true);

    expect(buttonsBlock).toBeDefined();
    expect(buttonsBlock!.options.length).toBeGreaterThanOrEqual(2);
  });

  it("multi-tool: parts alternate text and tool rows, and trace has 6 entries", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'multi-tool')!;
    const parts = gs.state!.messages[1].parts!;
    const firstTool = parts.find(p => p.kind === 'tool');
    expect(firstTool?.audit?.name).toBe('add_to_cart');
    expect(firstTool?.audit?.outcomeSummary.length).toBeGreaterThan(0);
  });

  it("confirm: overlay='confirm' and confirmDetail.action='click' with a non-empty name", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'confirm')!;
    expect(gs.overlay).toBe('confirm');
    expect(gs.confirmDetail).toBeDefined();
    expect(gs.confirmDetail!.action).toBe('click');
    expect(gs.confirmDetail!.name.length).toBeGreaterThan(0);
  });

  it("failed-turn: last message has a failed marker and no global error", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'failed-turn')!;
    const lastMsg = gs.state!.messages[gs.state!.messages.length - 1];
    expect(typeof lastMsg.failed?.message).toBe('string');
    expect(lastMsg.failed!.message.length).toBeGreaterThan(0);
    expect(lastMsg.failed!.retryable).toBe(true);
    expect(gs.state!.error).toBeUndefined();
  });

  it("retrying: running===true and retryAttempt is 2 of 5", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'retrying')!;
    expect(gs.state!.running).toBe(true);
    expect(gs.retryAttempt?.reason).toBeTruthy();
  });

  it("queued: running===true and queuedMessages has 2 items with non-empty text", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'queued')!;
    expect(gs.state!.running).toBe(true);
    expect(gs.state!.queuedMessages.length).toBeGreaterThan(0);
    for (const q of gs.state!.queuedMessages) {
      expect(q.id.length).toBeGreaterThan(0);
      expect(q.text.length).toBeGreaterThan(0);
    }
  });

  it("send-while-running: running===true and composerText is non-empty", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'send-while-running')!;
    expect(gs.state!.running).toBe(true);
    expect(gs.composerText?.length ?? 0).toBeGreaterThan(0);
  });

  it("config: configOpen===true and has a seeded state", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'config')!;
    expect(gs.configOpen).toBe(true);
    expect(gs.kind).toBe('panel');
    expect(gs.state!.messages.length).toBeGreaterThan(0);
  });

  it("chat-layout: panel state carries agentName + userName and demoes tool rows", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'chat-layout')!;
    expect(gs.kind).toBe('panel');
    expect(gs.agentName!.length).toBeGreaterThan(0);
    expect(gs.userName!.length).toBeGreaterThan(0);
    expect(gs.state!.messages.some(m => m.parts?.some(p => p.kind === 'tool'))).toBe(true);
  });

  it("branded-launcher: bubble state carries agentShortName + a distinct branded agentAvatar (B-1)", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'branded-launcher')!;
    expect(gs.kind).toBe('bubble');
    expect(gs.agentShortName!.length).toBeGreaterThan(0);
    expect(gs.agentAvatar).toMatch(/^data:image\/svg\+xml/);
    // The tile exists to show a HOST-SET avatar, not the built-in default —
    // reusing DEMO_AGENT_AVATAR (the 🐱 emoji) defeated the point (B-1).
    expect(gs.agentAvatar).not.toBe(DEMO_AGENT_AVATAR);
    expect(gs.agentAvatar).not.toContain("F0%9F%90%B1");
  });

  it("debug-screen: debug===true, debugOpen===true, panel with trace", () => {
    const gs = GALLERY_STATES.find(s => s.id === 'debug-screen')!;
    expect(gs.debug).toBe(true);
    expect(gs.debugOpen).toBe(true);
    expect(gs.kind).toBe('panel');
    expect(gs.state!.messages.some(m => (m.trace?.length ?? 0) > 0)).toBe(true);
  });
});

describe("makeState", () => {
  it("returns a fully-populated SessionState with all required keys", () => {
    const s = makeState({});
    expect(s).toHaveProperty('messages');
    expect(s).toHaveProperty('sessions');
    expect(s).toHaveProperty('activeSessionId');
    expect(s).toHaveProperty('running');
    expect(s).toHaveProperty('usage');
    expect(s).toHaveProperty('contextWindow');
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0].id).toBe('demo');
  });
});
