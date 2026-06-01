import { CodexChatReasoningConfig } from "./config";

export const THINK_OPEN_TAG = "<think>";
export const THINK_CLOSE_TAG = "</think>";

const O_SERIES_PREFIXES = ["o1", "o3", "o4", "gpt-5"];

export function isOpenaiOSeries(model: string): boolean {
  const modelLower = model.toLowerCase();
  return O_SERIES_PREFIXES.some((prefix) => modelLower.startsWith(prefix));
}

export function responseIdFromChatId(chatId?: string | null): string {
  const cid = chatId || "codex_bridge";
  if (cid.startsWith("resp_")) return cid;
  return `resp_${cid}`;
}

export function responseStatusFromFinishReason(finishReason?: string | null): string {
  if (finishReason === "length") return "incomplete";
  return "completed";
}

export function chatUsageToResponsesUsage(usage?: Record<string, unknown> | null): Record<string, unknown> {
  if (!usage || typeof usage !== "object") {
    return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  }

  const inputTokens = (usage.prompt_tokens as number) || (usage.input_tokens as number) || 0;
  const outputTokens = (usage.completion_tokens as number) || (usage.output_tokens as number) || 0;
  const totalTokens = (usage.total_tokens as number) || inputTokens + outputTokens;

  const result: Record<string, unknown> = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };

  let cached: unknown = null;
  const promptDetails = (usage.prompt_tokens_details as Record<string, unknown>) || {};
  const inputDetails = (usage.input_tokens_details as Record<string, unknown>) || {};
  if (typeof promptDetails === "object" && promptDetails) {
    cached = promptDetails.cached_tokens;
  }
  if (cached === null && typeof inputDetails === "object" && inputDetails) {
    cached = inputDetails.cached_tokens;
  }
  if (cached !== null && cached !== undefined) {
    result.input_tokens_details = { cached_tokens: cached };
  }

  if (usage.completion_tokens_details) {
    result.output_tokens_details = usage.completion_tokens_details;
  }
  if (usage.cache_read_input_tokens !== undefined) {
    result.cache_read_input_tokens = usage.cache_read_input_tokens;
  }
  if (usage.cache_creation_input_tokens !== undefined) {
    result.cache_creation_input_tokens = usage.cache_creation_input_tokens;
  }

  return result;
}

function extractReasoningDetailPartText(value: Record<string, unknown>): string | null {
  for (const key of ["text", "content", "summary"]) {
    const text = value[key];
    if (typeof text === "string" && text) return text;
  }
  const parts = value.parts;
  if (Array.isArray(parts)) {
    const joined = parts
      .map((item) => (typeof item === "object" && item ? extractReasoningDetailPartText(item as Record<string, unknown>) : null))
      .filter(Boolean)
      .join("\n\n");
    return joined || null;
  }
  return null;
}

function extractReasoningDetailsText(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) =>
        typeof item === "object" && item
          ? extractReasoningDetailPartText(item as Record<string, unknown>)
          : typeof item === "string"
            ? item
            : null,
      )
      .filter(Boolean) as string[];
    return parts.length ? parts.join("\n\n") : null;
  }
  if (typeof value === "object" && value) {
    return extractReasoningDetailPartText(value as Record<string, unknown>);
  }
  return null;
}

export function extractReasoningFieldText(value: Record<string, unknown>): string | null {
  for (const key of ["reasoning_content", "reasoning"]) {
    const field = value[key];
    if (typeof field === "string" && field) return field;
  }

  const reasoning = value.reasoning;
  if (typeof reasoning === "object" && reasoning) {
    for (const key of ["content", "text", "summary"]) {
      const text = (reasoning as Record<string, unknown>)[key];
      if (typeof text === "string" && text) return text;
    }
  }

  if (value.reasoning_details !== undefined) {
    const text = extractReasoningDetailsText(value.reasoning_details);
    if (text) return text;
  }

  return null;
}

export function extractReasoningSummaryText(value: Record<string, unknown>): string | null {
  for (const key of ["reasoning_content", "content", "text"]) {
    const text = value[key];
    if (typeof text === "string" && text) return text;
  }

  const summary = value.summary;
  if (typeof summary === "string" && summary) return summary;
  if (Array.isArray(summary)) {
    const parts: string[] = [];
    for (const part of summary) {
      if (typeof part === "object" && part) {
        const text = (part as Record<string, unknown>).text || (part as Record<string, unknown>).content;
        if (typeof text === "string" && text) parts.push(text);
      } else if (typeof part === "string" && part) {
        parts.push(part);
      }
    }
    return parts.length ? parts.join("\n\n") : null;
  }
  return null;
}

export function splitLeadingThinkBlock(text: string): [string, string] | null {
  const leadingWsLen = text.length - text.trimStart().length;
  const afterWs = text.slice(leadingWsLen);
  if (!afterWs.startsWith(THINK_OPEN_TAG)) return null;

  const bodyStart = leadingWsLen + THINK_OPEN_TAG.length;
  const closeRelative = text.slice(bodyStart).indexOf(THINK_CLOSE_TAG);
  if (closeRelative < 0) return null;

  const closeStart = bodyStart + closeRelative;
  const answerStart = closeStart + THINK_CLOSE_TAG.length;
  const reasoning = text.slice(bodyStart, closeStart).trim();
  const answer = text.slice(answerStart).replace(/^[\r\n\t ]+/, "");
  return [reasoning, answer];
}

export function stripLeadingThinkOpenTag(text: string): string | null {
  const leadingWsLen = text.length - text.trimStart().length;
  const afterWs = text.slice(leadingWsLen);
  if (afterWs.startsWith(THINK_OPEN_TAG)) {
    return afterWs.slice(THINK_OPEN_TAG.length).trim();
  }
  return null;
}

export function chatDeltaReasoningText(delta: Record<string, unknown>): string | null {
  return extractReasoningFieldText(delta);
}

export function chatReasoningText(message: Record<string, unknown>): string | null {
  const reasoning = extractReasoningFieldText(message);
  if (reasoning) return reasoning;

  const content = message.content;
  if (typeof content === "string") {
    const split = splitLeadingThinkBlock(content);
    if (split && split[0]) return split[0];
  }
  return null;
}

export function canonicalizeToolArguments(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const stripped = value.trim();
    if (!stripped) return "";
    try {
      return JSON.stringify(JSON.parse(stripped));
    } catch {
      return value;
    }
  }
  return JSON.stringify(value);
}

export function responseFunctionCallItem(
  itemId: string,
  status: string,
  callId: string,
  name: string,
  args: string,
  reasoning?: string | null,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: itemId,
    type: "function_call",
    status,
    call_id: callId,
    name,
    arguments: args,
  };
  if (reasoning && reasoning.trim()) {
    item.reasoning_content = reasoning.trim();
  }
  return item;
}

export function mapReasoningEffort(effort: string, mode = "passthrough"): string | null {
  const e = effort.trim().toLowerCase();
  if (["none", "off", "disabled"].includes(e)) return null;

  if (mode === "deepseek") {
    return e === "max" || e === "xhigh" ? "max" : "high";
  }
  if (mode === "low_high") {
    return e === "minimal" || e === "low" ? "low" : "high";
  }
  if (mode === "openrouter") {
    const mapping: Record<string, string> = {
      max: "xhigh",
      xhigh: "xhigh",
      high: "high",
      medium: "medium",
      low: "low",
      minimal: "minimal",
    };
    return mapping[e] ?? null;
  }

  const mapping: Record<string, string> = {
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  };
  return mapping[e] ?? null;
}

export function reasoningRequested(body: Record<string, unknown>): boolean | null {
  const reasoning = body.reasoning;
  if (typeof reasoning === "object" && reasoning) {
    const effort = (reasoning as Record<string, unknown>).effort;
    if (typeof effort === "string") {
      return !["none", "off", "disabled"].includes(effort.trim().toLowerCase());
    }
    return true;
  }
  if (reasoning !== undefined && reasoning !== null) return true;
  return null;
}

export function applyReasoningOptions(
  result: Record<string, unknown>,
  body: Record<string, unknown>,
  model: string,
  config?: CodexChatReasoningConfig | null,
): void {
  if (!config) {
    if (isOpenaiOSeries(model)) {
      const reasoning = body.reasoning;
      if (typeof reasoning === "object" && reasoning) {
        const effort = (reasoning as Record<string, unknown>).effort;
        if (effort !== undefined) result.reasoning_effort = effort;
      }
    }
    return;
  }

  const reasoningEnabled = reasoningRequested(body);
  if (reasoningEnabled === null) return;

  const supportsEffort = config.supportsEffort;
  const supportsThinking = config.supportsThinking || supportsEffort;
  const thinkingParam = (config.thinkingParam || "none").trim().toLowerCase();
  const effortParam = (config.effortParam || "none").trim().toLowerCase();

  if (supportsThinking && thinkingParam !== "none") {
    if (thinkingParam === "thinking") {
      result.thinking = { type: reasoningEnabled ? "enabled" : "disabled" };
    } else if (thinkingParam === "enable_thinking") {
      result.enable_thinking = reasoningEnabled;
    } else if (thinkingParam === "reasoning_split") {
      result.reasoning_split = reasoningEnabled;
    }
  }

  if (!reasoningEnabled) {
    if (effortParam === "reasoning.effort") {
      result.reasoning = { effort: "none" };
    }
    return;
  }

  if (!supportsEffort) return;

  const reasoningObj =
    typeof body.reasoning === "object" && body.reasoning ? (body.reasoning as Record<string, unknown>) : {};
  const effort = reasoningObj.effort;
  if (typeof effort !== "string") return;

  const mapped = mapReasoningEffort(effort, config.effortValueMode);
  if (!mapped) return;

  if (effortParam === "reasoning.effort") {
    result.reasoning = { effort: mapped };
  } else if (effortParam === "reasoning_effort") {
    result.reasoning_effort = mapped;
  }
}

const THINKING_BUDGET_BY_EFFORT: Record<string, number> = {
  minimal: 4096,
  low: 8192,
  medium: 12288,
  high: 16384,
  xhigh: 24576,
  max: 32768,
};

export function effortToThinkingBudget(effort: string, mode = "passthrough"): number {
  const mapped = mapReasoningEffort(effort, mode) || effort.trim().toLowerCase();
  return THINKING_BUDGET_BY_EFFORT[String(mapped).toLowerCase()] ?? 12288;
}

export function applyAnthropicReasoningOptions(
  params: Record<string, unknown>,
  body: Record<string, unknown>,
  _model: string,
  config?: CodexChatReasoningConfig | null,
): void {
  const reasoningEnabled = reasoningRequested(body);
  if (reasoningEnabled === null) return;

  const reasoningObj =
    typeof body.reasoning === "object" && body.reasoning ? (body.reasoning as Record<string, unknown>) : {};
  const effort = reasoningObj.effort;
  const effortMode = config?.effortValueMode ?? "passthrough";
  const thinkingParam = (config?.thinkingParam ?? "thinking").trim().toLowerCase();

  if (thinkingParam === "reasoning_split") {
    const extra = { ...((params.extra_body as Record<string, unknown>) || {}) };
    extra.reasoning_split = reasoningEnabled;
    params.extra_body = extra;
    return;
  }

  const supportsThinking = !!(config && (config.supportsThinking || config.supportsEffort));
  if (!config || thinkingParam === "thinking" || (thinkingParam === "none" && supportsThinking)) {
    if (!reasoningEnabled) {
      params.thinking = { type: "disabled" };
      return;
    }
    const budget = typeof effort === "string" ? effortToThinkingBudget(effort, effortMode) : 12288;
    params.thinking = { type: "enabled", budget_tokens: budget };
  }
}

export function instructionText(instructions: unknown): string {
  if (typeof instructions === "string") return instructions;
  if (Array.isArray(instructions)) {
    const parts: string[] = [];
    for (const block of instructions) {
      if (typeof block === "object" && block) {
        const text = (block as Record<string, unknown>).text || (block as Record<string, unknown>).content;
        if (typeof text === "string") parts.push(text);
      } else if (typeof block === "string") {
        parts.push(block);
      }
    }
    return parts.join("\n");
  }
  return instructions !== undefined && instructions !== null ? String(instructions) : "";
}

export function collapseSystemMessagesToHead(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  const systemChunks: string[] = [];
  const rest: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        systemChunks.push(content);
      }
      continue;
    }
    rest.push(msg);
  }

  const out: Record<string, unknown>[] = [];
  if (systemChunks.length) {
    out.push({ role: "system", content: systemChunks.join("\n\n") });
  }
  out.push(...rest);
  return out;
}
