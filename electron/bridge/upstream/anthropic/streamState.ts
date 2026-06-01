import { sseEmit } from "../../sse/emitter";

export class AnthropicToResponsesState {
  textBlockIndices = new Set<number>();
  toolUseIndices: Record<number, { id: string; name: string; arguments: string }> = {};
  thinkingBlockIndices = new Set<number>();
  doneIndices = new Set<number>();
  accumulatedText: Record<number, string> = {};
  accumulatedThinking: Record<number, string> = {};
  usage: Record<string, number> = { input_tokens: 0, output_tokens: 0 };
  outputIndexCounter = 0;
  idxToOutputIndex: Record<number, number> = {};
  msgId: string | null = null;
  model: string | null = null;
  completed = false;

  handleEvent(event: Record<string, unknown>): string[] {
    const et = event.type as string;
    if (et === "message_start") return this.handleMessageStart(event);
    if (et === "content_block_start") return this.handleContentBlockStart(event);
    if (et === "content_block_delta") return this.handleContentBlockDelta(event);
    if (et === "content_block_stop") return this.handleBlockStop(event);
    if (et === "message_delta") return this.handleMessageDelta(event);
    if (et === "message_stop") return this.handleMessageStop(event);
    return [];
  }

  private handleMessageStart(event: Record<string, unknown>): string[] {
    const message = event.message as Record<string, unknown>;
    this.msgId = String(message.id);
    this.model = String(message.model);
    const usage = message.usage as Record<string, unknown> | undefined;
    if (usage) {
      this.usage.input_tokens = Number(usage.input_tokens || 0);
    }
    const response = this.baseResponse("in_progress", []);
    return [sseEmit("response.created", { type: "response.created", response })];
  }

  private handleContentBlockStart(event: Record<string, unknown>): string[] {
    const block = event.content_block as Record<string, unknown>;
    const idx = Number(event.index);
    const blockType = block.type as string;

    if (blockType === "text") {
      const outIdx = this.nextOutputIndex();
      this.idxToOutputIndex[idx] = outIdx;
      this.textBlockIndices.add(idx);
      this.accumulatedText[idx] = "";
      const itemId = `msg_${this.msgId}_${outIdx}`;
      return [
        sseEmit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outIdx,
          item: { id: itemId, type: "message", role: "assistant", status: "in_progress", content: [] },
        }),
        sseEmit("response.content_part.added", {
          type: "response.content_part.added",
          item_id: itemId,
          output_index: outIdx,
          content_index: 0,
          part: { type: "output_text", text: "" },
        }),
      ];
    }

    if (blockType === "tool_use") {
      const outIdx = this.nextOutputIndex();
      this.idxToOutputIndex[idx] = outIdx;
      this.toolUseIndices[idx] = {
        id: String(block.id),
        name: String(block.name),
        arguments: "",
      };
      const itemId = `fc_${this.msgId}_${outIdx}`;
      const item = {
        id: itemId,
        type: "function_call",
        call_id: block.id,
        name: block.name,
        arguments: "",
        status: "in_progress",
      };
      return [
        sseEmit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outIdx,
          item,
        }),
      ];
    }

    if (blockType === "thinking") {
      const outIdx = this.nextOutputIndex();
      this.idxToOutputIndex[idx] = outIdx;
      this.thinkingBlockIndices.add(idx);
      const initial = String(block.thinking || "");
      this.accumulatedThinking[idx] = initial;
      const itemId = `rs_${this.msgId}_${outIdx}`;
      const events = [
        sseEmit("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outIdx,
          item: { id: itemId, type: "reasoning", status: "in_progress", summary: [] },
        }),
        sseEmit("response.reasoning_summary_part.added", {
          type: "response.reasoning_summary_part.added",
          item_id: itemId,
          output_index: outIdx,
          summary_index: 0,
          part: { type: "summary_text", text: "" },
        }),
      ];
      if (initial) {
        events.push(
          sseEmit("response.reasoning_summary_text.delta", {
            type: "response.reasoning_summary_text.delta",
            item_id: itemId,
            output_index: outIdx,
            summary_index: 0,
            delta: initial,
          }),
        );
      }
      return events;
    }

    return [];
  }

  private handleContentBlockDelta(event: Record<string, unknown>): string[] {
    const delta = event.delta as Record<string, unknown>;
    const idx = Number(event.index);
    const deltaType = delta.type as string;

    if (deltaType === "text_delta") {
      const text = String(delta.text || "");
      if (idx in this.accumulatedText) this.accumulatedText[idx] += text;
      const outIdx = this.idxToOutputIndex[idx] ?? idx;
      return [
        sseEmit("response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: `msg_${this.msgId}_${outIdx}`,
          output_index: outIdx,
          content_index: 0,
          delta: text,
        }),
      ];
    }

    if (deltaType === "input_json_delta") {
      const chunk = String(delta.partial_json || "");
      if (idx in this.toolUseIndices) this.toolUseIndices[idx].arguments += chunk;
      const outIdx = this.idxToOutputIndex[idx] ?? idx;
      return [
        sseEmit("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: `fc_${this.msgId}_${outIdx}`,
          output_index: outIdx,
          delta: chunk,
        }),
      ];
    }

    if (deltaType === "thinking_delta") {
      const text = String(delta.thinking || "");
      if (this.thinkingBlockIndices.has(idx)) this.accumulatedThinking[idx] += text;
      const outIdx = this.idxToOutputIndex[idx] ?? idx;
      return [
        sseEmit("response.reasoning_summary_text.delta", {
          type: "response.reasoning_summary_text.delta",
          item_id: `rs_${this.msgId}_${outIdx}`,
          output_index: outIdx,
          summary_index: 0,
          delta: text,
        }),
      ];
    }

    return [];
  }

  private handleBlockStop(event: Record<string, unknown>): string[] {
    const idx = Number(event.index);

    if (this.thinkingBlockIndices.has(idx) && !this.doneIndices.has(idx)) {
      this.doneIndices.add(idx);
      const outIdx = this.idxToOutputIndex[idx] ?? idx;
      const itemId = `rs_${this.msgId}_${outIdx}`;
      const text = this.accumulatedThinking[idx] || "";
      return [
        sseEmit("response.reasoning_summary_text.done", {
          type: "response.reasoning_summary_text.done",
          item_id: itemId,
          output_index: outIdx,
          summary_index: 0,
          text,
        }),
        sseEmit("response.reasoning_summary_part.done", {
          type: "response.reasoning_summary_part.done",
          item_id: itemId,
          output_index: outIdx,
          summary_index: 0,
          part: { type: "summary_text", text },
        }),
        sseEmit("response.output_item.done", {
          type: "response.output_item.done",
          output_index: outIdx,
          item: { id: itemId, type: "reasoning", summary: [{ type: "summary_text", text }] },
        }),
      ];
    }

    if (this.textBlockIndices.has(idx) && !this.doneIndices.has(idx)) {
      this.doneIndices.add(idx);
      const outIdx = this.idxToOutputIndex[idx] ?? idx;
      const itemId = `msg_${this.msgId}_${outIdx}`;
      const text = this.accumulatedText[idx] || "";
      return [
        sseEmit("response.output_text.done", {
          type: "response.output_text.done",
          item_id: itemId,
          output_index: outIdx,
          content_index: 0,
          text,
        }),
        sseEmit("response.content_part.done", {
          type: "response.content_part.done",
          item_id: itemId,
          output_index: outIdx,
          content_index: 0,
          part: { type: "output_text", text },
        }),
        sseEmit("response.output_item.done", {
          type: "response.output_item.done",
          output_index: outIdx,
          item: {
            id: itemId,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text }],
          },
        }),
      ];
    }

    if (idx in this.toolUseIndices) {
      this.doneIndices.add(idx);
      const outIdx = this.idxToOutputIndex[idx] ?? idx;
      const tool = this.toolUseIndices[idx];
      const fullArgs = tool.arguments;
      const itemId = `fc_${this.msgId}_${outIdx}`;
      return [
        sseEmit("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          item_id: itemId,
          output_index: outIdx,
          arguments: fullArgs,
        }),
        sseEmit("response.output_item.done", {
          type: "response.output_item.done",
          output_index: outIdx,
          item: {
            id: itemId,
            type: "function_call",
            call_id: tool.id,
            name: tool.name,
            arguments: fullArgs,
            status: "completed",
          },
        }),
      ];
    }

    return [];
  }

  private handleMessageDelta(event: Record<string, unknown>): string[] {
    const usage = event.usage as Record<string, unknown> | undefined;
    if (usage) {
      this.usage.output_tokens = Number(usage.output_tokens || 0);
    }
    return [];
  }

  private handleMessageStop(_event: Record<string, unknown>): string[] {
    const output = this.buildOutputItems();
    const usage = { ...this.usage, total_tokens: this.usage.input_tokens + this.usage.output_tokens };
    const response = this.baseResponse("completed", output);
    response.usage = usage;
    this.completed = true;
    return [sseEmit("response.completed", { type: "response.completed", response })];
  }

  private buildOutputItems(): Record<string, unknown>[] {
    const items: [number, Record<string, unknown>][] = [];

    for (const idx of this.textBlockIndices) {
      const oi = this.idxToOutputIndex[idx] ?? idx;
      const text = this.accumulatedText[idx] || "";
      items.push([
        oi,
        {
          type: "message",
          id: `msg_${this.msgId}_${oi}`,
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text }],
        },
      ]);
    }

    for (const idx of this.thinkingBlockIndices) {
      const oi = this.idxToOutputIndex[idx] ?? idx;
      const text = this.accumulatedThinking[idx] || "";
      items.push([
        oi,
        {
          type: "reasoning",
          id: `rs_${this.msgId}_${oi}`,
          status: "completed",
          summary: [{ type: "summary_text", text }],
        },
      ]);
    }

    for (const [idx, tool] of Object.entries(this.toolUseIndices)) {
      const oi = this.idxToOutputIndex[Number(idx)] ?? Number(idx);
      items.push([
        oi,
        {
          type: "function_call",
          id: `fc_${this.msgId}_${oi}`,
          call_id: tool.id,
          name: tool.name,
          arguments: tool.arguments,
          status: "completed",
        },
      ]);
    }

    items.sort((a, b) => a[0] - b[0]);
    return items.map(([, item]) => item);
  }

  private baseResponse(status: string, output: Record<string, unknown>[]): Record<string, unknown> {
    return {
      id: this.msgId || "unknown",
      object: "response",
      model: this.model || "",
      created_at: Math.floor(Date.now() / 1000),
      status,
      output,
    };
  }

  private nextOutputIndex(): number {
    const idx = this.outputIndexCounter;
    this.outputIndexCounter += 1;
    return idx;
  }

  failedResponse(message: string, errorType = "server_error"): string {
    this.completed = true;
    const usage = { ...this.usage, total_tokens: this.usage.input_tokens + this.usage.output_tokens };
    const response = this.baseResponse("failed", this.buildOutputItems());
    response.usage = usage;
    response.error = { message, type: errorType };
    return sseEmit("response.completed", { type: "response.completed", response });
  }
}
