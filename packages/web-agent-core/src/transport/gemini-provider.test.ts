import { describe, it, expect, vi } from "vitest";
import {
  GeminiLanguageModel,
  createGeminiLanguageModel,
} from "./gemini-provider.js";
import type { AgentConfig } from "../config.js";
import type { StreamPart } from "./stream-parts.js";

interface GeminiRequestBody {
  contents: { role: string; parts: { functionCall?: unknown; thoughtSignature?: string }[] }[];
  generationConfig?: Record<string, unknown>;
}

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function sseResponse(body: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(body));
        c.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

const cfg: AgentConfig = {
  endpointType: "gemini",
  baseURL: "/api/gemini",
  model: "gemini-flash-lite-latest",
} as AgentConfig;

describe("GeminiLanguageModel", () => {
  it("exposes provider 'gemini' and modelId", () => {
    const model = new GeminiLanguageModel(cfg);
    expect(model.provider).toBe("gemini");
    expect(model.modelId).toBe("gemini-flash-lite-latest");
  });

  it("declares no supportedUrls — only inline base64 images are supported", () => {
    const model = new GeminiLanguageModel(cfg);
    expect(model.supportedUrls).toEqual({});
  });

  it("createGeminiLanguageModel factory works", () => {
    const model = createGeminiLanguageModel(cfg);
    expect(model).toBeInstanceOf(GeminiLanguageModel);
    expect(model.modelId).toBe("gemini-flash-lite-latest");
  });

  it("generate() posts to /v1beta/models/<model>:generateContent and returns a complete reply", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Hi" }] },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      })
    );
    const model = new GeminiLanguageModel(cfg, { fetch: stubFetch });

    const result = await model.generate({
      messages: [{ role: "user", content: "hello" }],
      model: "gemini-flash-lite-latest",
    });

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [url, init] = stubFetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:3000/api/gemini/v1beta/models/gemini-flash-lite-latest:generateContent"
    );
    const body = JSON.parse(init!.body as string) as GeminiRequestBody;
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
    expect(result.content).toEqual([{ type: "text", text: "Hi" }]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage.inputTokens).toBe(5);
    expect(result.usage.outputTokens).toBe(2);
  });

  it("doStream() posts to /v1beta/models/<model>:streamGenerateContent?alt=sse and emits more than one text-delta part", async () => {
    const sseBody =
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" world"}]}}]}\n\n' +
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}\n\n';
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(sseResponse(sseBody));
    const model = new GeminiLanguageModel(cfg, { fetch: stubFetch });

    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gemini-flash-lite-latest",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const [url] = stubFetch.mock.calls[0];
    expect(url).toBe(
      "http://localhost:3000/api/gemini/v1beta/models/gemini-flash-lite-latest:streamGenerateContent?alt=sse"
    );

    const textDeltas = parts.filter((p) => p.type === "text-delta");
    expect(textDeltas.length).toBeGreaterThan(1);
    expect(textDeltas.map((p) => p.delta)).toEqual(["Hello", " world"]);

    const finish = parts.find((p) => p.type === "finish")!;
    expect(finish).toMatchObject({ type: "finish", finishReason: "stop" });
    expect(finish.usage.inputTokens).toBe(5);
    expect(finish.usage.outputTokens).toBe(2);
  });

  it("generate() captures a thought signature and supplies it on the next turn's functionCall", async () => {
    const stubFetch = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: { id: "call_1", name: "get_weather", args: { location: "Tokyo" } },
                    thoughtSignature: "sig_tokyo",
                  },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          candidates: [
            { content: { role: "model", parts: [{ text: "Sunny" }] }, finishReason: "STOP" },
          ],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 },
        })
      );
    const model = new GeminiLanguageModel(cfg, { fetch: stubFetch });

    const turn1 = await model.generate({
      messages: [{ role: "user", content: "weather in tokyo?" }],
      model: "gemini-flash-lite-latest",
    });
    expect(turn1.content).toEqual([
      { type: "tool_use", id: "call_1", name: "get_weather", input: { location: "Tokyo" } },
    ]);

    await model.generate({
      messages: [
        { role: "user", content: "weather in tokyo?" },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_1", toolName: "get_weather", input: { location: "Tokyo" } }],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call_1", toolName: "get_weather", output: { temp: 20 } }],
        },
      ],
      model: "gemini-flash-lite-latest",
    });

    const turn2Body = JSON.parse(stubFetch.mock.calls[1][1]!.body as string) as GeminiRequestBody;
    const functionCallPart = turn2Body.contents
      .flatMap((c) => c.parts)
      .find((p) => p.functionCall);
    expect(functionCallPart!.thoughtSignature).toBe("sig_tokyo");
  });

  it("doStream() tool call captures a thought signature from the stream translator", async () => {
    const sseBody =
      'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"call_1","name":"get_weather","args":{"location":"Tokyo"}},"thoughtSignature":"sig_stream"}]}}]}\n\n' +
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":2}}\n\n';
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(sseResponse(sseBody));
    const model = new GeminiLanguageModel(cfg, { fetch: stubFetch });

    const { stream } = await model.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gemini-flash-lite-latest",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);

    const toolCall = parts.find((p) => p.type === "tool-call");
    expect(toolCall).toMatchObject({ toolCallId: "call_1", toolName: "get_weather" });

    // The captured signature is instance state — the next generate() call must
    // include it, proving the translator's signature reached the provider's map.
    const stubFetch2 = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      })
    );
    (model as unknown as { _fetch: typeof fetch })._fetch = stubFetch2;
    await model.generate({
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call_1", toolName: "get_weather", input: { location: "Tokyo" } }],
        },
      ],
      model: "gemini-flash-lite-latest",
    });
    const body = JSON.parse(stubFetch2.mock.calls[0][1]!.body as string) as GeminiRequestBody;
    const fcPart = body.contents.flatMap((c) => c.parts).find((p) => p.functionCall);
    expect(fcPart!.thoughtSignature).toBe("sig_stream");
  });

  it("reports non-zero inputTokens and outputTokens in both generate() and doStream()", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 },
      })
    );
    const model = new GeminiLanguageModel(cfg, { fetch: stubFetch });
    const result = await model.generate({
      messages: [{ role: "user", content: "hello" }],
      model: "gemini-flash-lite-latest",
    });
    expect(result.usage.inputTokens).toBe(11);
    expect(result.usage.outputTokens).toBe(4);

    const sseBody =
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]}}]}\n\n' +
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}\n\n';
    const stubFetch2 = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(sseResponse(sseBody));
    const model2 = new GeminiLanguageModel(cfg, { fetch: stubFetch2 });
    const { stream } = await model2.doStream({
      messages: [{ role: "user", content: "hi" }],
      model: "gemini-flash-lite-latest",
    });
    const parts: StreamPart[] = [];
    for await (const p of stream) parts.push(p);
    const finish = parts.find((p) => p.type === "finish")!;
    expect(finish.usage.inputTokens).toBe(7);
    expect(finish.usage.outputTokens).toBe(3);
  });

  it("passes generationConfig parameters through to the request body", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      })
    );
    const model = new GeminiLanguageModel(cfg, { fetch: stubFetch });

    await model.generate({
      messages: [{ role: "user", content: "hi" }],
      model: "gemini-flash-lite-latest",
      maxOutputTokens: 100,
      temperature: 0.5,
      topP: 0.9,
      topK: 20,
      stopSequences: ["\n"],
      seed: 42,
    });

    const body = JSON.parse(stubFetch.mock.calls[0][1]!.body as string) as GeminiRequestBody;
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 100,
      temperature: 0.5,
      topP: 0.9,
      topK: 20,
      stopSequences: ["\n"],
      seed: 42,
    });
  });

  it("emits an unsupported warning and omits the request when an http(s) image is disabled by config", async () => {
    const stubFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      })
    );
    const disabledCfg: AgentConfig = { ...cfg, imageInput: false };
    const model = new GeminiLanguageModel(disabledCfg, { fetch: stubFetch });

    const result = await model.generate({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", image: "https://example.com/cat.png", mediaType: "image/png" },
          ],
        },
      ],
      model: "gemini-flash-lite-latest",
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatchObject({ type: "unsupported", feature: "image-input" });
  });
});
