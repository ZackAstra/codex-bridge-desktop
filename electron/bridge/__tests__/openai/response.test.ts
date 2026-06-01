import { describe, it, expect } from "vitest";
import { chatCompletionToResponse } from "../../upstream/openai/response";

describe("openai response", () => {
  it("non stream text response", () => {
    const resp = chatCompletionToResponse({
      id: "chatcmpl_1",
      created: 123,
      model: "gpt-5.4",
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Hello" } }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    });
    expect(resp.id).toBe("resp_chatcmpl_1");
    expect(resp.status).toBe("completed");
    expect((resp.output as Record<string, unknown>[])[0].type).toBe("message");
    expect(((resp.output as Record<string, unknown>[])[0].content as Record<string, unknown>[])[0].text).toBe(
      "Hello",
    );
  });

  it("non stream reasoning before message", () => {
    const resp = chatCompletionToResponse({
      id: "chatcmpl_2",
      created: 123,
      model: "deepseek",
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", reasoning_content: "think", content: "answer" },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    expect((resp.output as Record<string, unknown>[])[0].type).toBe("reasoning");
    expect((resp.output as Record<string, unknown>[])[1].type).toBe("message");
  });

  it("non stream length incomplete", () => {
    const resp = chatCompletionToResponse({
      id: "chatcmpl_3",
      created: 123,
      model: "gpt-4",
      choices: [{ finish_reason: "length", message: { role: "assistant", content: "partial" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    expect(resp.status).toBe("incomplete");
    expect((resp.incomplete_details as Record<string, unknown>).reason).toBe("max_output_tokens");
  });
});
