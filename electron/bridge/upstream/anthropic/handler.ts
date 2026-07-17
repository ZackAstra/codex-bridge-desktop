import Anthropic from "@anthropic-ai/sdk";
import { getSettings } from "../../config";
import { buildAnthropicCreateParams } from "./params";
import { convertInputToAnthropic, convertToolsToAnthropic } from "./request";
import { anthropicToResponse } from "./response";
import { AnthropicToResponsesState } from "./streamState";

export interface AnthropicHandlerResult {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  stream?: AsyncGenerator<string>;
}

export async function handleAnthropic(
  body: Record<string, unknown>,
  onLog?: (line: string) => void,
): Promise<AnthropicHandlerResult> {
  const settings = getSettings();
  const model = settings.anthropicModel || String(body.model || "");
  const codexModel = body.model;
  const maxOutputTokens = Number(body.max_output_tokens || body.max_tokens || 4096);
  const temperature = body.temperature;
  let instructions = (body.instructions || body.system) as string | undefined;
  const stream = Boolean(body.stream);
  const tools = body.tools;

  const [anthropicMessages, developerContent] = convertInputToAnthropic(body);
  const anthropicTools = tools ? convertToolsToAnthropic(tools) : null;

  if (developerContent) {
    instructions = developerContent + (instructions ? `\n${instructions}` : "");
  }

  const apiKey = settings.anthropicAuthToken;
  const baseUrl = settings.anthropicBaseUrl;

  if (stream) {
    log(onLog, "[anthropic] streaming mode");
    return {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "Transfer-Encoding": "chunked",
      },
      stream: streamAnthropic({
        body,
        settings,
        model,
        anthropicMessages,
        maxTokens: maxOutputTokens,
        temperature,
        instructions: instructions ?? null,
        apiKey,
        baseUrl,
        tools: anthropicTools,
        onLog,
      }),
    };
  }

  log(onLog, `[anthropic] non-stream mode: codex_model=${codexModel}, upstream_model=${model}, msgs=${anthropicMessages.length}`);

  const client = new Anthropic({ apiKey, baseURL: baseUrl });
  const params = buildAnthropicCreateParams(body, settings, {
    model,
    messages: anthropicMessages,
    maxTokens: maxOutputTokens,
    temperature,
    instructions: instructions ?? null,
    tools: anthropicTools,
  });

  try {
    const resp = await client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
    );
    log(onLog, `<- Anthropic: id=${resp.id}`);
    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: anthropicToResponse(resp as unknown as Parameters<typeof anthropicToResponse>[0]),
    };
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    log(onLog, `Anthropic error: ${err.message || e}`);
    const status = err.status === 400 ? 400 : 500;
    const type = err.status === 400 ? "invalid_request_error" : "internal_error";
    return {
      status,
      headers: { "Content-Type": "application/json" },
      body: { error: { message: String(err.message || e), type } },
    };
  }
}

async function* streamAnthropic(opts: {
  body: Record<string, unknown>;
  settings: ReturnType<typeof getSettings>;
  model: string;
  anthropicMessages: Record<string, unknown>[];
  maxTokens: number;
  temperature?: unknown;
  instructions?: string | null;
  apiKey: string;
  baseUrl: string;
  tools?: Record<string, unknown>[] | null;
  onLog?: (line: string) => void;
}): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl });
  const params = buildAnthropicCreateParams(opts.body, opts.settings, {
    model: opts.model,
    messages: opts.anthropicMessages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    instructions: opts.instructions,
    tools: opts.tools,
  });

  log(opts.onLog, `[anthropic] streaming: model=${opts.model}, msgs=${opts.anthropicMessages.length}`);

  const state = new AnthropicToResponsesState();
  try {
    const stream = client.messages.stream(
      params as unknown as Anthropic.MessageCreateParamsStreaming,
    );
    for await (const event of stream) {
      try {
        for (const sse of state.handleEvent(event as unknown as Record<string, unknown>)) {
          yield sse;
        }
      } catch (e) {
        log(opts.onLog, `[anthropic] event error: ${e}`);
      }
    }
    for (const sse of state.finalize()) {
      yield sse;
    }
  } catch (e) {
    log(opts.onLog, `[anthropic] stream error: ${e}`);
    if (!state.completed) {
      yield state.failedResponse(String(e));
    }
  }
}

function log(onLog: ((line: string) => void) | undefined, msg: string): void {
  if (onLog) onLog(`[PROXY] ${msg}`);
}
