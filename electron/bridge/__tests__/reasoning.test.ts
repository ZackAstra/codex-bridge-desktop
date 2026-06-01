import { describe, it, expect } from "vitest";
import {
  applyAnthropicReasoningOptions,
  applyReasoningOptions,
  collapseSystemMessagesToHead,
} from "../reasoning/apply";
import {
  CodexChatReasoningConfig,
  inferCodexChatReasoningConfig,
  resolveCodexChatReasoningConfig,
} from "../reasoning/config";

describe("reasoning", () => {
  it("infers deepseek", () => {
    const cfg = inferCodexChatReasoningConfig("https://api.deepseek.com/v1", "deepseek-v4-flash");
    expect(cfg).not.toBeNull();
    expect(cfg!.supportsThinking).toBe(true);
    expect(cfg!.effortValueMode).toBe("deepseek");
  });

  it("openrouter platform overrides deepseek model", () => {
    const cfg = inferCodexChatReasoningConfig(
      "https://openrouter.ai/api/v1",
      "deepseek/deepseek-chat-v3.1",
      "OpenRouter",
    );
    expect(cfg!.effortParam).toBe("reasoning.effort");
    expect(cfg!.effortValueMode).toBe("openrouter");
  });

  it("manual deepseek overrides auto", () => {
    const cfg = resolveCodexChatReasoningConfig(
      "https://openrouter.ai/api/v1",
      "deepseek/deepseek-chat",
      "deepseek",
      "OpenRouter",
    );
    expect(cfg!.effortValueMode).toBe("deepseek");
  });

  it("apply deepseek xhigh to max", () => {
    const result: Record<string, unknown> = {};
    const config: CodexChatReasoningConfig = {
      supportsThinking: true,
      supportsEffort: true,
      thinkingParam: "thinking",
      effortParam: "reasoning_effort",
      effortValueMode: "deepseek",
    };
    applyReasoningOptions(result, { reasoning: { effort: "xhigh" } }, "deepseek-v4", config);
    expect(result.thinking).toEqual({ type: "enabled" });
    expect(result.reasoning_effort).toBe("max");
  });

  it("apply anthropic thinking enabled", () => {
    const params: Record<string, unknown> = {};
    const config: CodexChatReasoningConfig = {
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: "thinking",
      effortParam: "none",
      effortValueMode: "passthrough",
    };
    applyAnthropicReasoningOptions(params, { reasoning: { effort: "high" } }, "claude-3-7", config);
    expect(params.thinking).toEqual({ type: "enabled", budget_tokens: 16384 });
  });

  it("collapse system messages", () => {
    const collapsed = collapseSystemMessagesToHead([
      { role: "system", content: "a" },
      { role: "system", content: "b" },
      { role: "user", content: "hi" },
    ]);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0].content).toBe("a\n\nb");
  });
});
