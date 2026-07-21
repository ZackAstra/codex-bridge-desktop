import { IncomingMessage } from "http";
import { getSettings } from "../../config";

export interface ResponseHandlerResult {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  stream?: AsyncGenerator<string>;
}

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
      headers: { "Content-Type": "application/json" },
      body: { error: { message: "RESPONSE_API_KEY not configured", type: "configuration_error" } },
    };
  }

  const stream = Boolean(body.stream);

  if (stream) {
    log(onLog, `[response] streaming mode: model=${model}`);
    return {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Transfer-Encoding": "chunked",
      },
      stream: streamResponse({ body, apiKey, baseUrl, model, onLog }),
    };
  }

  log(onLog, `[response] non-stream mode: model=${model}`);
  return await nonStreamResponse({ body, apiKey, baseUrl, model, onLog });
}

async function nonStreamResponse(opts: {
  body: Record<string, unknown>;
  apiKey: string;
  baseUrl: string;
  model: string;
  onLog?: (line: string) => void;
}): Promise<ResponseHandlerResult> {
  const url = `${opts.baseUrl}/responses`;
  const payload = { ...opts.body, model: opts.model, stream: false };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    log(opts.onLog, `[response] upstream status: ${resp.status}`);

    if (!resp.ok) {
      const text = await resp.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      return {
        status: resp.status,
        headers: { "Content-Type": "application/json" },
        body: { error: typeof parsed === "object" && parsed ? parsed : { message: text } },
      };
    }

    const data = await resp.json();
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: data,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(opts.onLog, `[response] error: ${msg}`);
    return {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: { message: msg, type: "upstream_error" } },
    };
  }
}

async function* streamResponse(opts: {
  body: Record<string, unknown>;
  apiKey: string;
  baseUrl: string;
  model: string;
  onLog?: (line: string) => void;
}): AsyncGenerator<string> {
  const url = `${opts.baseUrl}/responses`;
  const payload = { ...opts.body, model: opts.model, stream: true };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    log(opts.onLog, `[response] upstream status: ${resp.status}`);

    if (!resp.ok) {
      const text = await resp.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep text */ }
      const errMsg = typeof parsed === "object" && parsed && (parsed as Record<string, unknown>).error
        ? JSON.stringify((parsed as Record<string, unknown>).error)
        : text;
      yield `data: ${JSON.stringify({ type: "error", error: { message: errMsg } })}\n\n`;
      yield "data: [DONE]\n\n";
      return;
    }

    if (!resp.body) {
      yield `data: ${JSON.stringify({ type: "error", error: { message: "Empty response body" } })}\n\n`;
      yield "data: [DONE]\n\n";
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          yield `${trimmed}\n`;
        }
      }
    }

    if (buffer.trim()) {
      yield `${buffer.trim()}\n`;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(opts.onLog, `[response] stream error: ${msg}`);
    yield `data: ${JSON.stringify({ type: "error", error: { message: msg } })}\n\n`;
    yield "data: [DONE]\n\n";
  }
}

function log(onLog: ((line: string) => void) | undefined, msg: string): void {
  if (onLog) onLog(`[PROXY] ${msg}`);
}
