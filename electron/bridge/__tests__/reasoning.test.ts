import { describe, it, expect } from "vitest";
import {
  applyAnthropicReasoningOptions,
  applyReasoningOptions,
  collapseSystemMessagesToHead,
  mapReasoningEffort,
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

  it("apply deepseek xhigh to high and ultra to max", () => {
    const config: CodexChatReasoningConfig = {
      supportsThinking: true,
      supportsEffort: true,
      thinkingParam: "thinking",
      effortParam: "reasoning_effort",
      effortValueMode: "deepseek",
    };
    const xhigh: Record<string, unknown> = {};
    applyReasoningOptions(xhigh, { reasoning: { effort: "xhigh" } }, "deepseek-v4", config);
    expect(xhigh.thinking).toEqual({ type: "enabled" });
    expect(xhigh.reasoning_effort).toBe("high");

    const ultra: Record<string, unknown> = {};
    applyReasoningOptions(ultra, { reasoning: { effort: "ultra" } }, "deepseek-v4", config);
    expect(ultra.reasoning_effort).toBe("max");
  });

  it("mapReasoningEffort deepseek_responses follows the official table", () => {
    const expected: Record<string, string> = {
      minimal: "low",
      low: "low",
      medium: "high",
      high: "high",
      xhigh: "high",
      max: "max",
      ultra: "max",
    };
    for (const [input, output] of Object.entries(expected)) {
      expect(mapReasoningEffort(input, "deepseek_responses")).toBe(output);
    }
    expect(mapReasoningEffort("none", "deepseek_responses")).toBeNull();
  });

  it("does not infer deepseek for reseller hosts", () => {
    expect(
      inferCodexChatReasoningConfig(
        "https://ark.cn-beijing.volces.com/api/v3",
        "deepseek-v4-flash",
      ),
    ).toBeNull();
  });

  it("manual deepseek mode works without inference", () => {
    const cfg = resolveCodexChatReasoningConfig(
      "https://ark.cn-beijing.volces.com/api/v3",
      "deepseek-v4-flash",
      "deepseek",
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.supportsThinking).toBe(true);
    expect(cfg!.thinkingParam).toBe("thinking");
    expect(cfg!.effortParam).toBe("reasoning_effort");
  });

  it("writes output_config.effort for native anthropic deepseek", () => {
    const cfg = inferCodexChatReasoningConfig(
      "https://api.deepseek.com/anthropic",
      "deepseek-flash",
    );
    const params: Record<string, unknown> = {};
    applyAnthropicReasoningOptions(
      params,
      { reasoning: { effort: "xhigh" } },
      "deepseek-flash",
      cfg,
    );
    expect((params.thinking as Record<string, unknown>).type).toBe("enabled");
    expect(params.output_config).toEqual({ effort: "high" });
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
