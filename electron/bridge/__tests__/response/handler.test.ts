import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearSettingsCache, loadSettings } from "../../config";
import { handleResponse } from "../../upstream/response/handler";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function jsonResp(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("response upstream handler", () => {
  beforeEach(() => {
    loadSettings({
      UPSTREAM_FORMAT: "response",
      RESPONSE_API_KEY: "sk-test",
      RESPONSE_BASE_URL: "https://upstream.example/v1",
      RESPONSE_MODEL: "test-model",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSettingsCache();
  });

  it("returns 500 config error when api key is missing", async () => {
    loadSettings({ UPSTREAM_FORMAT: "response", RESPONSE_API_KEY: "" });
    const result = await handleResponse({ model: "m", stream: true });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).toContain("RESPONSE_API_KEY");
  });

  it("forwards upstream 429 as real HTTP error with normalized message", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResp(429, { error: { message: "rate limit exceeded", type: "rate_limit_error" } }, { "Retry-After": "30" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleResponse({ model: "m", stream: true });

    expect(result.status).toBe(429);
    expect(result.stream).toBeUndefined();
    expect(result.headers["Retry-After"]).toBe("30");
    const errBody = result.body as { error: { message: string; type: string } };
    expect(errBody.error.message).toBe("rate limit exceeded");
    expect(errBody.error.type).toBe("rate_limit_error");
  });

  it("passes full codex payload through with model/stream override", async () => {
    const fetchMock = vi.fn(async () => new Response(sseStream(["data: {}\n\n"]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await handleResponse({
      model: "codex-model",
      stream: true,
      instructions: "sys",
      input: [{ type: "message", role: "user", content: [] }],
      tools: [{ type: "function", name: "shell" }],
      reasoning: { effort: "high" },
      store: false,
      upstream_format: "response",
    });

    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent.model).toBe("test-model");
    expect(sent.stream).toBe(true);
    expect(sent.instructions).toBe("sys");
    expect(sent.input).toHaveLength(1);
    expect(sent.tools).toHaveLength(1);
    expect(sent.reasoning).toEqual({ effort: "high" });
    expect(sent.store).toBe(false);
    expect(sent.upstream_format).toBeUndefined();
  });

  it("passes through native responses SSE preserving event framing", async () => {
    const sse =
      'event: response.created\ndata: {"type":"response.created","response":{"status":"in_progress"}}\n\n' +
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sseStream([sse]), { status: 200 })));

    const result = await handleResponse({ model: "m", stream: true });
    expect(result.status).toBe(200);
    expect(result.headers["Content-Type"]).toBe("text/event-stream");

    let out = "";
    for await (const chunk of result.stream!) out += chunk;
    expect(out).toBe(sse);
    expect(out).toContain("event: response.completed\n");
    expect(out).toContain("\n\n");
  });

  it("emits spec-compliant response.failed when stream breaks mid-flight", async () => {
    let step = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (step === 0) {
          step = 1;
          controller.enqueue(new TextEncoder().encode('event: response.created\ndata: {"type":"response.created"}\n\n'));
        } else {
          controller.error(new Error("connection reset"));
        }
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(broken, { status: 200 })));

    const result = await handleResponse({ model: "m", stream: true });
    let out = "";
    for await (const chunk of result.stream!) out += chunk;

    expect(out).toContain("event: response.created");
    expect(out).toContain("event: response.failed");
    expect(out).toContain('"status":"failed"');
    expect(out).toContain("connection reset");
  });
  it("remaps reasoning effort only for native deepseek upstream", async () => {
    loadSettings({
      UPSTREAM_FORMAT: "response",
      RESPONSE_API_KEY: "sk-test",
      RESPONSE_BASE_URL: "https://api.deepseek.com/v1",
      RESPONSE_MODEL: "deepseek-v4-flash",
    });
    const fetchMock = vi.fn(async () => jsonResp(200, { status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    await handleResponse({ model: "m", reasoning: { effort: "medium", summary: "auto" } });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.deepseek.com/responses");
    let sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent.reasoning).toEqual({ effort: "high", summary: "auto" });

    await handleResponse({ model: "m", reasoning: { effort: "low" } });
    sent = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(sent.reasoning.effort).toBe("low");

    await handleResponse({ model: "m", reasoning: { effort: "xhigh" } });
    sent = JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body));
    expect(sent.reasoning.effort).toBe("high");

    await handleResponse({ model: "m", reasoning: { effort: "ultra" } });
    sent = JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body));
    expect(sent.reasoning.effort).toBe("max");
  });

  it("normalizes native deepseek base url variants to the canonical endpoint", async () => {
    const variants: [string, string][] = [
      ["https://api.deepseek.com", "https://api.deepseek.com/responses"],
      ["https://api.deepseek.com/", "https://api.deepseek.com/responses"],
      ["https://api.deepseek.com/v1", "https://api.deepseek.com/responses"],
      ["https://api.deepseek.com/v1/", "https://api.deepseek.com/responses"],
      ["https://api.deepseek.com/responses", "https://api.deepseek.com/responses"],
      ["https://api.deepseek.com/v1/responses", "https://api.deepseek.com/responses"],
    ];
    const fetchMock = vi.fn(async () => jsonResp(200, { status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    for (const [baseUrl, expected] of variants) {
      loadSettings({
        UPSTREAM_FORMAT: "response",
        RESPONSE_API_KEY: "sk-test",
        RESPONSE_BASE_URL: baseUrl,
      });
      fetchMock.mockClear();
      await handleResponse({ model: "m" });
      expect(String(fetchMock.mock.calls[0][0])).toBe(expected);
    }
  });
  it("does not treat http or lookalike hosts as native deepseek", async () => {
    const fetchMock = vi.fn(async () => jsonResp(200, { status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);
    for (const baseUrl of [
      "http://api.deepseek.com/v1",
      "https://foo.api.deepseek.com/v1",
      "https://api.deepseek.com.evil.test/v1",
    ]) {
      loadSettings({
        UPSTREAM_FORMAT: "response",
        RESPONSE_API_KEY: "sk-test",
        RESPONSE_BASE_URL: baseUrl,
        RESPONSE_MODEL: "deepseek-flash",
      });
      fetchMock.mockClear();
      await handleResponse({ model: "m", reasoning: { effort: "medium" } });
      const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
      expect(sent.reasoning.effort).toBe("medium");
    }
  });

  it("keeps reasoning effort untouched for platform-level responses upstream", async () => {
    loadSettings({
      UPSTREAM_FORMAT: "response",
      RESPONSE_API_KEY: "sk-test",
      RESPONSE_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
      RESPONSE_MODEL: "deepseek-v4-flash",
    });
    const fetchMock = vi.fn(async () => jsonResp(200, { status: "completed" }));
    vi.stubGlobal("fetch", fetchMock);

    await handleResponse({ model: "m", reasoning: { effort: "medium" } });
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(sent.reasoning.effort).toBe("medium");
  });
});
