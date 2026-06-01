import { describe, it, expect } from "vitest";
import { responsesToChatCompletions } from "../../upstream/openai/request";

describe("openai request", () => {
  it("instructions become system message", () => {
    const result = responsesToChatCompletions({
      model: "gpt-4",
      instructions: "You are helpful.",
      input: "Hello",
      stream: true,
    });
    expect(result.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ]);
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it("function call batching", () => {
    const result = responsesToChatCompletions({
      model: "gpt-4",
      input: [
        { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    });
    const msgs = result.messages as Record<string, unknown>[];
    expect(msgs[0].role).toBe("assistant");
    expect((msgs[0].tool_calls as unknown[]).length).toBe(1);
    expect(msgs[1].role).toBe("tool");
    expect(msgs[1].tool_call_id).toBe("c1");
  });

  it("max output tokens o series", () => {
    const result = responsesToChatCompletions({ model: "o3-mini", max_output_tokens: 1000, input: "hi" });
    expect(result.max_completion_tokens).toBe(1000);
  });
});
