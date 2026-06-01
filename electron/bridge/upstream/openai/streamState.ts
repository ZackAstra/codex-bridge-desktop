import {
  THINK_CLOSE_TAG,
  THINK_OPEN_TAG,
  canonicalizeToolArguments,
  chatDeltaReasoningText,
  chatUsageToResponsesUsage,
  responseFunctionCallItem,
  responseIdFromChatId,
  responseStatusFromFinishReason,
  splitLeadingThinkBlock,
  stripLeadingThinkOpenTag,
} from "../../reasoning/apply";
import { sseEmit } from "../../sse/emitter";

enum InlineThinkMode {
  DETECTING = "detecting",
  REASONING = "reasoning",
  TEXT = "text",
}

enum ThinkPrefixDecision {
  NEED_MORE = "need_more",
  REASONING = "reasoning",
  TEXT = "text",
}

interface TextItemState {
  outputIndex: number | null;
  itemId: string;
  text: string;
  added: boolean;
  done: boolean;
}

interface ReasoningItemState {
  outputIndex: number | null;
  itemId: string;
  text: string;
  added: boolean;
  done: boolean;
}

interface InlineThinkState {
  mode: InlineThinkMode;
  buffer: string;
}

interface ToolCallState {
  outputIndex: number | null;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  reasoningContent: string;
  added: boolean;
  done: boolean;
}

export class ChatToResponsesState {
  responseStarted = false;
  completed = false;
  responseId = "resp_codex_bridge";
  model = "";
  createdAt = 0;
  nextOutputIndexCounter = 0;
  text: TextItemState = { outputIndex: null, itemId: "", text: "", added: false, done: false };
  reasoning: ReasoningItemState = { outputIndex: null, itemId: "", text: "", added: false, done: false };
  inlineThink: InlineThinkState = { mode: InlineThinkMode.DETECTING, buffer: "" };
  tools: Record<number, ToolCallState> = {};
  outputItems: [number, Record<string, unknown>][] = [];
  latestUsage: Record<string, unknown> | null = null;
  finishReason: string | null = null;

  constructor(responseId?: string) {
    if (responseId) this.responseId = responseId;
  }

  handleChatChunk(chunk: Record<string, unknown>): string[] {
    const events: string[] = [];

    if (chunk.id) this.responseId = responseIdFromChatId(String(chunk.id));
    if (chunk.model) this.model = String(chunk.model);
    if (chunk.created) this.createdAt = Number(chunk.created);

    events.push(...this.ensureResponseStarted());

    const usage = chunk.usage;
    if (typeof usage === "object" && usage && Object.keys(usage).length) {
      this.latestUsage = chatUsageToResponsesUsage(usage as Record<string, unknown>);
    }

    const choices = (chunk.choices as unknown[]) || [];
    if (!choices.length) return events;

    const choice = choices[0] as Record<string, unknown>;
    const delta = (choice.delta as Record<string, unknown>) || {};

    const reasoning = chatDeltaReasoningText(delta);
    if (reasoning) events.push(...this.pushReasoningDelta(reasoning));

    const content = delta.content;
    if (typeof content === "string" && content) {
      events.push(...this.pushContentDelta(content));
    }

    const toolCalls = delta.tool_calls;
    if (Array.isArray(toolCalls)) {
      events.push(...this.flushInlineThinkAtBoundary());
      const reasoningForTool = this.currentReasoningText();
      events.push(...this.finalizeReasoning());
      for (const toolCall of toolCalls) {
        events.push(...this.pushToolCallDelta(toolCall as Record<string, unknown>, reasoningForTool));
      }
    }

    const finishReason = choice.finish_reason;
    if (typeof finishReason === "string") this.finishReason = finishReason;

    return events;
  }

  pushContentDelta(delta: string): string[] {
    const mode = this.inlineThink.mode;
    if (mode === InlineThinkMode.TEXT) {
      const events = this.finalizeReasoning();
      events.push(...this.pushTextDelta(delta));
      return events;
    }

    if (mode === InlineThinkMode.DETECTING) {
      this.inlineThink.buffer += delta;
      const decision = leadingThinkPrefixDecision(this.inlineThink.buffer);
      if (decision === ThinkPrefixDecision.NEED_MORE) return [];
      if (decision === ThinkPrefixDecision.REASONING) {
        this.inlineThink.mode = InlineThinkMode.REASONING;
        return this.drainCompleteInlineThink();
      }
      this.inlineThink.mode = InlineThinkMode.TEXT;
      const text = this.inlineThink.buffer;
      this.inlineThink.buffer = "";
      const events = this.finalizeReasoning();
      events.push(...this.pushTextDelta(text));
      return events;
    }

    this.inlineThink.buffer += delta;
    return this.drainCompleteInlineThink();
  }

  drainCompleteInlineThink(): string[] {
    const split = splitLeadingThinkBlock(this.inlineThink.buffer);
    if (!split) return [];

    const [reasoning, answer] = split;
    this.inlineThink.mode = InlineThinkMode.TEXT;
    this.inlineThink.buffer = "";

    const events: string[] = [];
    if (reasoning) {
      events.push(...this.pushReasoningDelta(reasoning));
      events.push(...this.finalizeReasoning());
    }
    if (answer) events.push(...this.pushTextDelta(answer));
    return events;
  }

  flushInlineThinkAtBoundary(): string[] {
    const mode = this.inlineThink.mode;
    if (mode === InlineThinkMode.TEXT) return [];

    if (mode === InlineThinkMode.DETECTING) {
      this.inlineThink.mode = InlineThinkMode.TEXT;
      const text = this.inlineThink.buffer;
      this.inlineThink.buffer = "";
      if (!text) return [];
      const events = this.finalizeReasoning();
      events.push(...this.pushTextDelta(text));
      return events;
    }

    const buffered = this.inlineThink.buffer;
    this.inlineThink.buffer = "";
    this.inlineThink.mode = InlineThinkMode.TEXT;
    const split = splitLeadingThinkBlock(buffered);
    if (split) {
      const [reasoning, answer] = split;
      const events: string[] = [];
      if (reasoning) {
        events.push(...this.pushReasoningDelta(reasoning));
        events.push(...this.finalizeReasoning());
      }
      if (answer) events.push(...this.pushTextDelta(answer));
      return events;
    }

    const reasoning = stripLeadingThinkOpenTag(buffered) || buffered;
    if (!reasoning) return [];
    const events = this.pushReasoningDelta(reasoning);
    events.push(...this.finalizeReasoning());
    return events;
  }

  ensureResponseStarted(): string[] {
    if (this.responseStarted) return [];
    this.responseStarted = true;
    const response = this.baseResponse("in_progress", []);
    return [
      sseEmit("response.created", { type: "response.created", response }),
      sseEmit("response.in_progress", {
        type: "response.in_progress",
        response: this.baseResponse("in_progress", []),
      }),
    ];
  }

  pushReasoningDelta(delta: string): string[] {
    const events: string[] = [];
    if (!this.reasoning.added) {
      const outputIndex = this.allocOutputIndex();
      const itemId = `rs_${this.responseId}`;
      this.reasoning.outputIndex = outputIndex;
      this.reasoning.itemId = itemId;
      this.reasoning.added = true;
      events.push(
        sseEmit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item: { id: itemId, type: "reasoning", status: "in_progress", summary: [] },
        }),
      );
      events.push(
        sseEmit("response.reasoning_summary_part.added", {
          type: "response.reasoning_summary_part.added",
          item_id: itemId,
          output_index: outputIndex,
          summary_index: 0,
          part: { type: "summary_text", text: "" },
        }),
      );
    }

    this.reasoning.text += delta;
    const outputIndex = this.reasoning.outputIndex ?? 0;
    events.push(
      sseEmit("response.reasoning_summary_text.delta", {
        type: "response.reasoning_summary_text.delta",
        item_id: this.reasoning.itemId,
        output_index: outputIndex,
        summary_index: 0,
        delta,
      }),
    );
    return events;
  }

  pushTextDelta(delta: string): string[] {
    const events: string[] = [];
    if (!this.text.added) {
      const outputIndex = this.allocOutputIndex();
      const itemId = `${this.responseId}_msg`;
      this.text.outputIndex = outputIndex;
      this.text.itemId = itemId;
      this.text.added = true;
      events.push(
        sseEmit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item: {
            id: itemId,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        }),
      );
      events.push(
        sseEmit("response.content_part.added", {
          type: "response.content_part.added",
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        }),
      );
    }

    this.text.text += delta;
    const outputIndex = this.text.outputIndex ?? 0;
    events.push(
      sseEmit("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        delta,
      }),
    );
    return events;
  }

  currentReasoningText(): string | null {
    const text = this.reasoning.text.trim();
    return text || null;
  }

  pushToolCallDelta(toolCall: Record<string, unknown>, reasoning: string | null): string[] {
    const chatIndex = Number(toolCall.index ?? 0);
    const idDelta = toolCall.id;
    const fn = (toolCall.function as Record<string, unknown>) || {};
    const nameDelta = fn.name;
    const argsDelta = fn.arguments || "";

    if (!this.tools[chatIndex]) {
      this.tools[chatIndex] = {
        outputIndex: null,
        itemId: "",
        callId: "",
        name: "",
        arguments: "",
        reasoningContent: "",
        added: false,
        done: false,
      };
    }
    const state = this.tools[chatIndex];
    if (idDelta) state.callId = String(idDelta);
    if (nameDelta) state.name = String(nameDelta);
    if (argsDelta) state.arguments += String(argsDelta);
    if (!state.reasoningContent && reasoning) state.reasoningContent = reasoning;

    const events: string[] = [];
    const shouldAdd = !state.added && (state.callId || state.name);

    if (shouldAdd) {
      const outputIndex = this.allocOutputIndex();
      state.added = true;
      if (!state.callId) state.callId = `call_${chatIndex}`;
      if (!state.name) state.name = "unknown_tool";
      state.outputIndex = outputIndex;
      state.itemId = `fc_${state.callId}`;
      const pendingArgs = state.arguments;
      const item = responseFunctionCallItem(
        state.itemId,
        "in_progress",
        state.callId,
        state.name,
        "",
        state.reasoningContent || null,
      );
      events.push(
        sseEmit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item,
        }),
      );
      if (pendingArgs) {
        events.push(
          sseEmit("response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta",
            item_id: state.itemId,
            output_index: outputIndex,
            delta: pendingArgs,
          }),
        );
      }
    } else if (argsDelta && state.added) {
      const outputIndex = state.outputIndex ?? 0;
      events.push(
        sseEmit("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: state.itemId,
          output_index: outputIndex,
          delta: String(argsDelta),
        }),
      );
    }

    return events;
  }

  finalize(): string[] {
    if (this.completed) return [];

    const events = this.ensureResponseStarted();
    events.push(...this.flushInlineThinkAtBoundary());
    events.push(...this.finalizeReasoning());
    events.push(...this.finalizeText());
    events.push(...this.finalizeTools());

    const status = responseStatusFromFinishReason(this.finishReason);
    const response = this.baseResponse(status, this.completedOutputItems());
    if (status === "incomplete") {
      response.incomplete_details = { reason: "max_output_tokens" };
    }

    events.push(sseEmit("response.completed", { type: "response.completed", response }));
    this.completed = true;
    return events;
  }

  finalizeReasoning(): string[] {
    if (!this.reasoning.added || this.reasoning.done) return [];

    const outputIndex = this.reasoning.outputIndex ?? 0;
    const itemId = this.reasoning.itemId;
    const text = this.reasoning.text;
    const item = {
      id: itemId,
      type: "reasoning",
      summary: [{ type: "summary_text", text }],
    };
    this.outputItems.push([outputIndex, item]);
    this.reasoning.done = true;

    return [
      sseEmit("response.reasoning_summary_text.done", {
        type: "response.reasoning_summary_text.done",
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        text,
      }),
      sseEmit("response.reasoning_summary_part.done", {
        type: "response.reasoning_summary_part.done",
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        part: { type: "summary_text", text },
      }),
      sseEmit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: outputIndex,
        item,
      }),
    ];
  }

  finalizeText(): string[] {
    if (!this.text.added || this.text.done) return [];

    const outputIndex = this.text.outputIndex ?? 0;
    const item = {
      id: this.text.itemId,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: this.text.text, annotations: [] }],
    };
    this.outputItems.push([outputIndex, item]);
    this.text.done = true;

    return [
      sseEmit("response.output_text.done", {
        type: "response.output_text.done",
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        text: this.text.text,
      }),
      sseEmit("response.content_part.done", {
        type: "response.content_part.done",
        item_id: this.text.itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: "output_text", text: this.text.text, annotations: [] },
      }),
      sseEmit("response.output_item.done", {
        type: "response.output_item.done",
        output_index: outputIndex,
        item,
      }),
    ];
  }

  finalizeTools(): string[] {
    const events: string[] = [];
    const keys = Object.keys(this.tools)
      .map(Number)
      .sort((a, b) => a - b);

    for (const key of keys) {
      const state = this.tools[key];
      if (state.done) continue;

      if (!state.added) {
        const outputIndex = this.allocOutputIndex();
        state.added = true;
        if (!state.callId) state.callId = `call_${key}`;
        if (!state.name) state.name = "unknown_tool";
        state.outputIndex = outputIndex;
        state.itemId = `fc_${state.callId}`;
        const item = responseFunctionCallItem(
          state.itemId,
          "in_progress",
          state.callId,
          state.name,
          "",
          state.reasoningContent || null,
        );
        events.push(
          sseEmit("response.output_item.added", {
            type: "response.output_item.added",
            output_index: outputIndex,
            item,
          }),
        );
      }

      const outputIndex = state.outputIndex ?? 0;
      const args = canonicalizeToolArguments(state.arguments);
      const item = responseFunctionCallItem(
        state.itemId,
        "completed",
        state.callId,
        state.name,
        args,
        state.reasoningContent || null,
      );
      state.done = true;
      this.outputItems.push([outputIndex, item]);

      events.push(
        sseEmit("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          item_id: state.itemId,
          output_index: outputIndex,
          arguments: args,
        }),
      );
      events.push(
        sseEmit("response.output_item.done", {
          type: "response.output_item.done",
          output_index: outputIndex,
          item,
        }),
      );
    }

    return events;
  }

  completedOutputItems(): Record<string, unknown>[] {
    return [...this.outputItems].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
  }

  baseResponse(status: string, output: Record<string, unknown>[]): Record<string, unknown> {
    const usage = this.latestUsage || {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
    const created = this.createdAt || Math.floor(Date.now() / 1000);
    return {
      id: this.responseId,
      object: "response",
      created_at: created,
      status,
      model: this.model,
      output,
      usage,
    };
  }

  failedEvent(message: string, errorType?: string | null): string {
    this.completed = true;
    const error: Record<string, unknown> = { message };
    if (errorType) error.type = errorType;
    const response = this.baseResponse("failed", this.completedOutputItems());
    response.error = error;
    return sseEmit("response.failed", { type: "response.failed", response });
  }

  private allocOutputIndex(): number {
    const index = this.nextOutputIndexCounter;
    this.nextOutputIndexCounter += 1;
    return index;
  }
}

function leadingThinkPrefixDecision(buffer: string): ThinkPrefixDecision {
  const trimmed = buffer.trimStart();
  if (!trimmed) return ThinkPrefixDecision.NEED_MORE;
  if (trimmed.startsWith(THINK_OPEN_TAG)) return ThinkPrefixDecision.REASONING;
  if (THINK_OPEN_TAG.startsWith(trimmed)) return ThinkPrefixDecision.NEED_MORE;
  return ThinkPrefixDecision.TEXT;
}
