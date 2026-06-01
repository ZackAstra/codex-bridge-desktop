import { describe, it, expect } from "vitest";
import { chatErrorToResponseError } from "../../upstream/openai/errors";
import { processChatSseChunks } from "../../upstream/openai/stream";

describe("openai stream", () => {
  it("converts text chat sse to responses sse", () => {
    const output = processChatSseChunks([
      'data: {"id":"chatcmpl_1","created":123,"model":"gpt-5.4","choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"id":"chatcmpl_1","created":123,"model":"gpt-5.4","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(output).toContain("event: response.created");
    expect(output).toContain("event: response.in_progress");
    expect(output).toContain("response.output_text.delta");
    expect(output).toContain("response.output_text.done");
    expect(output).toContain("event: response.completed");
    expect(output.includes("Hello") || output.includes("Hel")).toBe(true);
  });

  it("converts reasoning content stream", () => {
    const output = processChatSseChunks([
      'data: {"id":"chatcmpl_2","created":123,"model":"deepseek","choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
      'data: {"id":"chatcmpl_2","created":123,"model":"deepseek","choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(output).toContain("response.reasoning_summary_text.delta");
    expect(output).toContain("response.output_text.delta");
    expect(output).toContain("response.reasoning_summary_text.done");
  });

  it("converts inline think content", () => {
    const output = processChatSseChunks([
      'data: {"id":"chatcmpl_3","created":123,"model":"m","choices":[{"delta":{"content":"' +
        "<think>inner</think>out" +
        '"}}]}\n\n',
      'data: {"id":"chatcmpl_3","created":123,"model":"m","choices":[{"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(output).toContain("response.reasoning_summary_text.delta");
    expect(output).toContain("inner");
    expect(output).toContain("out");
  });

  it("converts tool calls stream", () => {
    const output = processChatSseChunks([
      'data: {"id":"chatcmpl_4","created":123,"model":"gpt","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"shell","arguments":""}}]}}]}\n\n',
      'data: {"id":"chatcmpl_4","created":123,"model":"gpt","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"ls\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(output).toContain("response.output_item.added");
    expect(output).toContain("function_call");
    expect(output).toContain("response.function_call_arguments.delta");
    expect(output).toContain("response.function_call_arguments.done");
  });

  it("chat error to response error minimax", () => {
    const err = chatErrorToResponseError({ base_resp: { status_code: 2013, status_msg: "invalid" } });
    expect(err.message).toBe("invalid");
    expect(err.code).toBe(2013);
  });
});
