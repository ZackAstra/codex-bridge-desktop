import { Settings } from "../../config";
import { resolveCodexChatReasoningConfig } from "../../reasoning/config";
import { chatErrorToResponseError } from "./errors";
import { responsesToChatCompletions } from "./request";
import { chatCompletionToResponse } from "./response";
import { createResponsesSseStreamFromChat } from "./stream";
import { ChatToResponsesState } from "./streamState";

export class OpenAIUpstreamClient {
  baseUrl: string;
  apiKey: string;
  settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
    this.baseUrl = settings.openaiBaseUrl.replace(/\/$/, "");
    this.apiKey = settings.openaiApiKey;
  }

  headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  buildChatPayload(body: Record<string, unknown>): Record<string, unknown> {
    const upstreamModel = String(this.settings.anthropicModel || body.model || "");
    const reasoningConfig = resolveCodexChatReasoningConfig(
      this.baseUrl,
      upstreamModel,
      this.settings.codexChatReasoningMode,
    );
    const payload = responsesToChatCompletions(body, reasoningConfig);
    if (upstreamModel) payload.model = upstreamModel;
    return payload;
  }

  async *streamChatCompletions(
    payload: Record<string, unknown>,
    requestId: string,
  ): AsyncGenerator<string> {
    const url = `${this.baseUrl}/chat/completions`;
    this.log(
      `[openai] streaming mode: model=${payload.model}, msgs=${((payload.messages as unknown[]) || []).length}`,
    );
    this.log(`[openai] upstream POST ${url}`);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });

      this.log(`[openai] upstream status: ${resp.status}`);

      if (!resp.ok) {
        const text = await resp.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep text */
        }
        const err = chatErrorToResponseError(parsed);
        const state = new ChatToResponsesState(requestId);
        yield state.failedEvent(String(err.message), String(err.type));
        return;
      }

      if (!resp.body) {
        const state = new ChatToResponsesState(requestId);
        yield state.failedEvent("Empty response body", "stream_error");
        return;
      }

      async function* byteIter(reader: ReadableStream<Uint8Array>): AsyncGenerator<Buffer> {
        const streamReader = reader.getReader();
        while (true) {
          const { done, value } = await streamReader.read();
          if (done) break;
          if (value && value.length) yield Buffer.from(value);
        }
      }

      for await (const sse of createResponsesSseStreamFromChat(byteIter(resp.body))) {
        this.log(`[openai] SSE OUT: ${sse.slice(0, 150)}`);
        yield sse;
      }
    } catch (exc) {
      this.log(`[openai] stream error: ${exc}`);
      const state = new ChatToResponsesState(requestId);
      yield state.failedEvent(String(exc), "stream_error");
    }
  }

  async postChatCompletions(payload: Record<string, unknown>): Promise<[number, unknown]> {
    const url = `${this.baseUrl}/chat/completions`;
    this.log(`[openai] non-stream request: ${JSON.stringify(payload).slice(0, 500)}`);

    const resp = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    this.log(`[openai] upstream status: ${resp.status}`);

    if (!resp.ok) {
      let parsed: unknown;
      try {
        parsed = await resp.json();
      } catch {
        parsed = await resp.text();
      }
      return [resp.status, chatErrorToResponseError(parsed)];
    }

    return [resp.status, chatCompletionToResponse((await resp.json()) as Record<string, unknown>)];
  }

  private log(msg: string): void {
    if (this.onLog) this.onLog(`[PROXY] ${msg}`);
  }

  onLog?: (line: string) => void;
}
