import { applyAnthropicReasoningOptions } from "../../reasoning/apply";
import { resolveCodexChatReasoningConfig } from "../../reasoning/config";
import { Settings } from "../../config";

export function buildAnthropicCreateParams(
  body: Record<string, unknown>,
  settings: Settings,
  opts: {
    model: string;
    messages: Record<string, unknown>[];
    maxTokens: number;
    temperature?: unknown;
    instructions?: string | null;
    tools?: Record<string, unknown>[] | null;
  },
): Record<string, unknown> {
  const reasoningConfig = resolveCodexChatReasoningConfig(
    settings.anthropicBaseUrl,
    opts.model,
    settings.codexChatReasoningMode,
  );

  const params: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens,
  };

  if (opts.temperature !== undefined && opts.temperature !== null) {
    params.temperature = opts.temperature;
  }
  if (opts.instructions) params.system = opts.instructions;
  if (opts.tools) params.tools = opts.tools;

  applyAnthropicReasoningOptions(params, body, opts.model, reasoningConfig);
  return params;
}
