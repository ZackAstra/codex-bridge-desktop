import { randomBytes } from "crypto";
import { getSettings } from "../../config";
import { OpenAIUpstreamClient } from "./client";

export interface OpenAIHandlerResult {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  stream?: AsyncGenerator<string>;
}

export async function handleOpenai(body: Record<string, unknown>, onLog?: (line: string) => void): Promise<OpenAIHandlerResult> {
  const settings = getSettings();
  const client = new OpenAIUpstreamClient(settings);
  client.onLog = onLog;

  const codexModel = body.model;
  const stream = Boolean(body.stream);
  const tools = body.tools;

  const payload = client.buildChatPayload(body);
  log(onLog, `[openai] handle_openai: codex_model=${codexModel}, upstream_model=${payload.model}, stream=${stream}, tools=${Array.isArray(tools) ? tools.length : 0}`);

  const requestId = (body.id as string) || `resp_${randomBytes(12).toString("hex")}`;

  if (stream || payload.stream) {
    log(onLog, "[openai] entering stream mode");
    return {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Request-ID": requestId,
        "X-Accel-Buffering": "no",
        "Transfer-Encoding": "chunked",
      },
      stream: client.streamChatCompletions(payload, requestId),
    };
  }

  const [status, result] = await client.postChatCompletions(payload);
  if (status !== 200) {
    log(onLog, `[openai] upstream error: ${JSON.stringify(result).slice(0, 500)}`);
    return { status, headers: { "Content-Type": "application/json" }, body: { error: result } };
  }

  log(onLog, `[openai] response: ${JSON.stringify(result).slice(0, 500)}`);
  return { status: 200, headers: { "Content-Type": "application/json" }, body: result };
}

function log(onLog: ((line: string) => void) | undefined, msg: string): void {
  if (onLog) onLog(`[PROXY] ${msg}`);
}
