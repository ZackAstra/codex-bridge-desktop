import { chatUsageToResponsesUsage } from "../../reasoning/apply";

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
}

interface AnthropicResponse {
  id: string;
  model: string;
  content?: AnthropicBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function anthropicToResponse(resp: AnthropicResponse): Record<string, unknown> {
  const output: Record<string, unknown>[] = [];
  let outIdx = 0;

  for (const block of resp.content || []) {
    if (block.type === "text") {
      output.push({
        type: "message",
        id: `msg_${resp.id}_${outIdx}`,
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: block.text }],
      });
      outIdx += 1;
    } else if (block.type === "tool_use") {
      output.push({
        type: "function_call",
        id: `fc_${resp.id}_${outIdx}`,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
        status: "completed",
      });
      outIdx += 1;
    } else if (block.type === "thinking") {
      output.push({
        type: "reasoning",
        id: `rs_${resp.id}_${outIdx}`,
        status: "completed",
        summary: [{ type: "summary_text", text: block.thinking }],
      });
      outIdx += 1;
    }
  }

  const usage = chatUsageToResponsesUsage({
    input_tokens: resp.usage?.input_tokens ?? 0,
    output_tokens: resp.usage?.output_tokens ?? 0,
  });

  return {
    id: resp.id,
    object: "response",
    model: resp.model,
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    output,
    usage,
  };
}
