import {
  canonicalizeToolArguments,
  chatReasoningText,
  chatUsageToResponsesUsage,
  responseFunctionCallItem,
  responseIdFromChatId,
  responseStatusFromFinishReason,
  splitLeadingThinkBlock,
} from "../../reasoning/apply";

export function chatCompletionToResponse(body: Record<string, unknown>): Record<string, unknown> {
  const choices = (body.choices as unknown[]) || [];
  if (!choices.length) {
    return {
      id: responseIdFromChatId(body.id as string),
      object: "response",
      created_at: body.created || 0,
      status: "failed",
      model: body.model || "",
      output: [],
      error: { message: "No choices in chat response", type: "api_error" },
      usage: chatUsageToResponsesUsage(body.usage as Record<string, unknown>),
    };
  }

  const choice = choices[0] as Record<string, unknown>;
  const message = (choice.message as Record<string, unknown>) || {};
  const finishReason = choice.finish_reason as string | undefined;
  const responseId = responseIdFromChatId(body.id as string);

  const reasoning = chatReasoningText(message);
  const output: Record<string, unknown>[] = [];

  if (reasoning) {
    output.push(chatReasoningToResponseOutputItem(reasoning, responseId));
  }

  const messageItem = chatMessageToResponseOutputItem(message, responseId);
  if (messageItem) output.push(messageItem);

  output.push(...chatToolCallsToResponseOutputItems(message, reasoning));

  const response: Record<string, unknown> = {
    id: responseId,
    object: "response",
    created_at: body.created || 0,
    status: responseStatusFromFinishReason(finishReason),
    model: body.model || "",
    output,
    usage: chatUsageToResponsesUsage(body.usage as Record<string, unknown>),
  };

  if (finishReason === "length") {
    response.incomplete_details = { reason: "max_output_tokens" };
  }

  return response;
}

function chatReasoningToResponseOutputItem(reasoning: string, responseId: string): Record<string, unknown> {
  return {
    id: `rs_${responseId}`,
    type: "reasoning",
    summary: [{ type: "summary_text", text: reasoning }],
  };
}

function chatMessageToResponseOutputItem(
  message: Record<string, unknown>,
  responseId: string,
): Record<string, unknown> | null {
  const contentParts: Record<string, unknown>[] = [];

  const content = message.content;
  if (typeof content === "string") {
    const split = splitLeadingThinkBlock(content);
    const text = split ? split[1] : content;
    if (text) contentParts.push({ type: "output_text", text, annotations: [] });
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part !== "object" || !part) continue;
      const p = part as Record<string, unknown>;
      const partType = p.type || "";
      if (partType === "text" || partType === "output_text") {
        const text = p.text;
        if (text) contentParts.push({ type: "output_text", text, annotations: [] });
      } else if (partType === "refusal") {
        const refusal = p.refusal;
        if (refusal) contentParts.push({ type: "refusal", refusal });
      }
    }
  }

  const refusal = message.refusal;
  if (typeof refusal === "string" && refusal) {
    contentParts.push({ type: "refusal", refusal });
  }

  if (!contentParts.length) return null;

  return {
    id: `${responseId}_msg`,
    type: "message",
    status: "completed",
    role: "assistant",
    content: contentParts,
  };
}

function chatToolCallsToResponseOutputItems(
  message: Record<string, unknown>,
  reasoning: string | null,
): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const toolCalls = message.tool_calls;
  if (Array.isArray(toolCalls)) {
    toolCalls.forEach((toolCall, index) => {
      output.push(chatToolCallToResponseItem(toolCall as Record<string, unknown>, index, reasoning));
    });
  } else if (message.function_call) {
    output.push(chatLegacyFunctionCallToResponseItem(message.function_call as Record<string, unknown>, reasoning));
  }
  return output;
}

function chatToolCallToResponseItem(
  toolCall: Record<string, unknown>,
  index: number,
  reasoning: string | null,
): Record<string, unknown> {
  const callId = (toolCall.id as string) || `call_${index}`;
  const fn = (toolCall.function as Record<string, unknown>) || {};
  const name = String(fn.name || "");
  const args = canonicalizeToolArguments(fn.arguments);
  const itemId = `fc_${callId}`;
  return responseFunctionCallItem(itemId, "completed", callId, name, args, reasoning);
}

function chatLegacyFunctionCallToResponseItem(
  functionCall: Record<string, unknown>,
  reasoning: string | null,
): Record<string, unknown> {
  const callId = (functionCall.id as string) || "call_0";
  const name = String(functionCall.name || "");
  const args = canonicalizeToolArguments(functionCall.arguments);
  const itemId = `fc_${callId}`;
  return responseFunctionCallItem(itemId, "completed", callId, name, args, reasoning);
}
