import {
  applyReasoningOptions,
  collapseSystemMessagesToHead,
  extractReasoningSummaryText,
  instructionText,
  isOpenaiOSeries,
} from "../../reasoning/apply";
import { CodexChatReasoningConfig } from "../../reasoning/config";

const EXTRA_CHAT_PASSTHROUGH_FIELDS = [
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "stop",
  "user",
  "n",
  "logit_bias",
  "response_format",
  "parallel_tool_calls",
];

interface PendingState {
  toolCalls: Record<string, unknown>[];
  reasoning: string | null;
  lastAssistantIndex: number | null;
}

function createPendingState(): PendingState {
  return { toolCalls: [], reasoning: null, lastAssistantIndex: null };
}

export function responsesToChatCompletions(
  body: Record<string, unknown>,
  reasoningConfig?: CodexChatReasoningConfig | null,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (body.model !== undefined) result.model = body.model;

  const messages: Record<string, unknown>[] = [];
  const instructions = body.instructions;
  if (instructions !== undefined) {
    const text = instructionText(instructions);
    if (text) messages.push({ role: "system", content: text });
  }

  if (body.input !== undefined) {
    appendResponsesInputAsChatMessages(body.input, messages);
  }

  result.messages = collapseSystemMessagesToHead(messages);

  const model = String(body.model || "");
  const maxOut = body.max_output_tokens ?? body.max_tokens;
  if (maxOut !== undefined) {
    if (isOpenaiOSeries(model)) {
      result.max_completion_tokens = maxOut;
    } else {
      result.max_tokens = maxOut;
    }
  }
  if (body.max_completion_tokens !== undefined) {
    result.max_completion_tokens = body.max_completion_tokens;
  }

  for (const key of ["temperature", "top_p", "stream"]) {
    if (body[key] !== undefined) result[key] = body[key];
  }

  applyReasoningOptions(result, body, model, reasoningConfig);

  const tools = body.tools;
  if (Array.isArray(tools)) {
    const chatTools = tools
      .map((item) => responsesToolToChatTool(item))
      .filter(Boolean) as Record<string, unknown>[];
    if (chatTools.length) result.tools = chatTools;
  }

  if (body.tool_choice !== undefined) {
    result.tool_choice = responsesToolChoiceToChat(body.tool_choice);
  }

  for (const key of EXTRA_CHAT_PASSTHROUGH_FIELDS) {
    if (body[key] !== undefined) result[key] = body[key];
  }

  if (result.stream) {
    const streamOptions =
      typeof result.stream_options === "object" && result.stream_options
        ? { ...(result.stream_options as Record<string, unknown>) }
        : {};
    streamOptions.include_usage = true;
    result.stream_options = streamOptions;
  }

  return result;
}

function responsesToolToChatTool(tool: unknown): Record<string, unknown> | null {
  if (typeof tool !== "object" || !tool) return null;
  const t = tool as Record<string, unknown>;

  if (t.function !== undefined) {
    const chatTool = { ...t };
    const strict = t.strict;
    if (strict !== undefined && typeof chatTool.function === "object" && chatTool.function) {
      const fn = { ...(chatTool.function as Record<string, unknown>) };
      if (fn.strict === undefined) fn.strict = strict;
      chatTool.function = fn;
      delete chatTool.strict;
    }
    return chatTool;
  }

  if (t.type === "function") {
    const fn: Record<string, unknown> = {
      name: t.name || "",
      description: t.description || "",
      parameters: t.parameters || { type: "object", properties: {} },
    };
    if (t.strict !== undefined) fn.strict = t.strict;
    return { type: "function", function: fn };
  }

  return null;
}

function responsesToolChoiceToChat(toolChoice: unknown): unknown {
  if (typeof toolChoice === "object" && toolChoice && (toolChoice as Record<string, unknown>).type === "function") {
    const tc = toolChoice as Record<string, unknown>;
    return { type: "function", function: { name: tc.name || "" } };
  }
  return toolChoice;
}

function appendResponsesInputAsChatMessages(inputVal: unknown, messages: Record<string, unknown>[]): void {
  const pending = createPendingState();

  if (typeof inputVal === "string") {
    messages.push({ role: "user", content: inputVal });
    return;
  }

  const items = Array.isArray(inputVal) ? inputVal : [inputVal];
  for (const item of items) {
    appendResponsesItemAsChatMessage(item, messages, pending);
  }
  flushPendingToolCalls(messages, pending);
}

function appendResponsesItemAsChatMessage(
  item: unknown,
  messages: Record<string, unknown>[],
  pending: PendingState,
): void {
  if (typeof item !== "object" || !item) {
    messages.push({ role: "user", content: String(item) });
    return;
  }

  const obj = item as Record<string, unknown>;
  const itemType = obj.type;

  if (itemType === "function_call") {
    appendPendingReasoning(pending, responsesItemReasoningText(obj));
    pending.toolCalls.push(responsesFunctionCallToChatToolCall(obj));
    return;
  }

  if (itemType === "function_call_output") {
    flushPendingToolCalls(messages, pending);
    const callId = obj.call_id || "";
    const output = obj.output;
    let content: string;
    if (typeof output === "string") {
      content = canonicalizeJsonStringIfParseable(output);
    } else if (output !== undefined && output !== null) {
      content = JSON.stringify(output);
    } else {
      content = "";
    }
    messages.push({ role: "tool", tool_call_id: callId, content });
    pending.lastAssistantIndex = null;
    return;
  }

  if (itemType === "reasoning") {
    const reasoning = responsesReasoningItemText(obj);
    const attached =
      !pending.toolCalls.length &&
      attachReasoningToLastAssistant(messages, pending.lastAssistantIndex, reasoning);
    if (!attached) appendPendingReasoning(pending, reasoning);
    return;
  }

  flushPendingToolCalls(messages, pending);
  if (obj.role !== undefined || obj.content !== undefined) {
    const message = responsesMessageItemToChatMessage(obj, pending);
    updateLastAssistantIndex(messages, message, pending);
    messages.push(message);
  }
}

function flushPendingToolCalls(messages: Record<string, unknown>[], pending: PendingState): void {
  if (!pending.toolCalls.length) return;

  const message: Record<string, unknown> = {
    role: "assistant",
    content: null,
    tool_calls: [...pending.toolCalls],
  };
  pending.toolCalls = [];
  if (pending.reasoning && pending.reasoning.trim()) {
    message.reasoning_content = pending.reasoning.trim();
    pending.reasoning = null;
  }

  pending.lastAssistantIndex = messages.length;
  messages.push(message);
}

function responsesFunctionCallToChatToolCall(item: Record<string, unknown>): Record<string, unknown> {
  const callId = item.call_id || item.id || "";
  let args = item.arguments ?? "{}";
  if (typeof args !== "string") args = JSON.stringify(args);
  return {
    id: callId,
    type: "function",
    function: { name: item.name || "", arguments: args },
  };
}

function responsesRoleToChatRole(role: string): string {
  if (role === "system" || role === "developer") return "system";
  if (role === "assistant") return "assistant";
  if (role === "tool") return "tool";
  return "user";
}

function responsesMessageItemToChatMessage(
  item: Record<string, unknown>,
  pending: PendingState,
): Record<string, unknown> {
  const role = responsesRoleToChatRole(String(item.role || "user"));
  const contentVal = item.content;
  const content =
    contentVal !== undefined ? responsesContentToChatContent(role, contentVal) : null;
  const message: Record<string, unknown> = { role, content };
  if (role === "assistant") {
    appendPendingReasoning(pending, responsesMessageReasoningText(item));
    if (pending.reasoning && pending.reasoning.trim()) {
      message.reasoning_content = pending.reasoning.trim();
      pending.reasoning = null;
    }
  } else if (pending.reasoning) {
    pending.reasoning = null;
  }
  return message;
}

function responsesContentToChatContent(role: string, content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  const textTypes =
    role === "assistant" ? ["output_text", "text"] : ["input_text", "text", "output_text"];
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || !block) continue;
    const b = block as Record<string, unknown>;
    if (textTypes.includes(String(b.type || ""))) {
      const text = b.text;
      if (text) parts.push(String(text));
    }
  }
  return parts.length ? parts.join("\n") : "";
}

function responsesItemReasoningText(item: Record<string, unknown>): string | null {
  const rc = item.reasoning_content;
  if (typeof rc === "string" && rc) return rc;
  return extractReasoningSummaryText(item);
}

function responsesReasoningItemText(item: Record<string, unknown>): string | null {
  return extractReasoningSummaryText(item);
}

function responsesMessageReasoningText(item: Record<string, unknown>): string | null {
  const rc = item.reasoning_content;
  if (typeof rc === "string" && rc) return rc;
  return extractReasoningSummaryText(item);
}

function appendPendingReasoning(pending: PendingState, reasoning: string | null): void {
  if (!reasoning || !reasoning.trim()) return;
  if (pending.reasoning) {
    pending.reasoning = `${pending.reasoning}\n\n${reasoning.trim()}`;
  } else {
    pending.reasoning = reasoning.trim();
  }
}

function attachReasoningToLastAssistant(
  messages: Record<string, unknown>[],
  lastAssistantIndex: number | null,
  reasoning: string | null,
): boolean {
  if (lastAssistantIndex === null || !reasoning) return false;
  if (lastAssistantIndex >= messages.length) return false;
  const msg = messages[lastAssistantIndex];
  if (msg.role !== "assistant") return false;
  const existing = msg.reasoning_content;
  if (existing) {
    msg.reasoning_content = `${existing}\n\n${reasoning.trim()}`;
  } else {
    msg.reasoning_content = reasoning.trim();
  }
  return true;
}

function updateLastAssistantIndex(
  messages: Record<string, unknown>[],
  message: Record<string, unknown>,
  pending: PendingState,
): void {
  const role = message.role;
  if (role === "assistant") {
    pending.lastAssistantIndex = messages.length;
  } else if (role !== "tool") {
    pending.lastAssistantIndex = null;
  }
}

function canonicalizeJsonStringIfParseable(value: string): string {
  const stripped = value.trim();
  if (!stripped) return value;
  try {
    return JSON.stringify(JSON.parse(stripped));
  } catch {
    return value;
  }
}
