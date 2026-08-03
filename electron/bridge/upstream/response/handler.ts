import { getSettings } from "../../config";
import { chatErrorToResponseError } from "../openai/errors";
import { ChatToResponsesState } from "../openai/streamState";
import { adaptNativeDeepseekPayload, isNativeDeepseekResponsesUrl } from "./deepseek";

export interface ResponseHandlerResult {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  stream?: AsyncGenerator<string>;
}

const JSON_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  "Transfer-Encoding": "chunked",
};

export async function handleResponse(
  body: Record<string, unknown>,
  onLog?: (line: string) => void,
): Promise<ResponseHandlerResult> {
  const settings = getSettings();
  const apiKey = settings.responseApiKey;
  const baseUrl = settings.responseBaseUrl.replace(/\/$/, "");
  const model = settings.responseModel || String(body.model || "");

  if (!apiKey) {
    log(onLog, "[response] RESPONSE_API_KEY not set");
    return {
      status: 500,
      headers: JSON_HEADERS,
      body: { error: { message: "RESPONSE_API_KEY not configured", type: "configuration_error" } },
    };
  }

  const stream = Boolean(body.stream);
  const payload: Record<string, unknown> = { ...body, model, stream };
  delete payload.upstream_format;

  if (isNativeDeepseekResponsesUrl(baseUrl)) {
    adaptNativeDeepseekPayload(payload);
    log(onLog, "[response] native deepseek upstream detected, payload adapted");
  }

  log(onLog, `[response] ${stream ? "streaming" : "non-stream"} mode: model=${model}`);

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(onLog, `[response] fetch error: ${msg}`);
    return {
      status: 500,
      headers: JSON_HEADERS,
      body: { error: { message: msg, type: "upstream_error" } },
    };
  }

  log(onLog, `[response] upstream status: ${resp.status}`);

  if (!resp.ok) {
    const text = await resp.text();
    log(onLog, `[response] upstream error body: ${text.slice(0, 500)}`);
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const headers: Record<string, string> = { ...JSON_HEADERS };
    const retryAfter = resp.headers.get("retry-after");
    if (retryAfter) headers["Retry-After"] = retryAfter;
    return {
      status: resp.status,
      headers,
      body: { error: chatErrorToResponseError(parsed) },
    };
  }

  if (stream) {
    if (!resp.body) {
      return {
        status: 502,
        headers: JSON_HEADERS,
        body: { error: { message: "Empty upstream response body", type: "upstream_error" } },
      };
    }
    return {
      status: 200,
      headers: { ...SSE_HEADERS },
      stream: pipeSse(resp.body, onLog),
    };
  }

  const data = await resp.json();
  return { status: 200, headers: JSON_HEADERS, body: data };
}

async function* pipeSse(
  body: ReadableStream<Uint8Array>,
  onLog?: (line: string) => void,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(onLog, `[response] stream error: ${msg}`);
    yield new ChatToResponsesState().failedEvent(msg, "stream_error");
  }
}

function log(onLog: ((line: string) => void) | undefined, msg: string): void {
  if (onLog) onLog(`[PROXY] ${msg}`);
}
