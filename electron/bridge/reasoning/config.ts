export const MANUAL_EFFORT_MODES = new Set(["passthrough", "deepseek", "openrouter", "low_high"]);

export interface CodexChatReasoningConfig {
  supportsThinking: boolean;
  supportsEffort: boolean;
  thinkingParam: string;
  effortParam: string;
  effortValueMode: string;
}

export function normalizeConfig(config: CodexChatReasoningConfig): CodexChatReasoningConfig {
  if (config.supportsEffort) {
    return { ...config, supportsThinking: true };
  }
  return config;
}

export function inferAggregatorPlatformConfig(
  providerName: string,
  baseUrl: string,
): CodexChatReasoningConfig | null {
  const platform = `${providerName} ${baseUrl}`.toLowerCase();

  if (platform.includes("openrouter")) {
    return normalizeConfig({
      supportsThinking: false,
      supportsEffort: true,
      thinkingParam: "none",
      effortParam: "reasoning.effort",
      effortValueMode: "openrouter",
    });
  }

  if (platform.includes("siliconflow")) {
    return normalizeConfig({
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: "enable_thinking",
      effortParam: "none",
      effortValueMode: "passthrough",
    });
  }

  return null;
}

export function inferCodexChatReasoningConfig(
  baseUrl: string,
  model: string,
  providerName = "",
): CodexChatReasoningConfig | null {
  const name = providerName.toLowerCase();
  const url = baseUrl.toLowerCase();
  const modelLower = model.toLowerCase();

  const platformConfig = inferAggregatorPlatformConfig(name, url);
  if (platformConfig !== null) return platformConfig;

  const haystack = `${name} ${url} ${modelLower}`;

  if (haystack.includes("deepseek")) {
    return normalizeConfig({
      supportsThinking: true,
      supportsEffort: true,
      thinkingParam: "thinking",
      effortParam: "reasoning_effort",
      effortValueMode: "deepseek",
    });
  }

  if (haystack.includes("stepfun") || haystack.includes("step-3.5-flash-2603")) {
    const supportsEffort = haystack.includes("step-3.5-flash-2603") || modelLower.includes("2603");
    return normalizeConfig({
      supportsThinking: supportsEffort,
      supportsEffort,
      thinkingParam: supportsEffort ? "thinking" : "none",
      effortParam: supportsEffort ? "reasoning_effort" : "none",
      effortValueMode: supportsEffort ? "low_high" : "passthrough",
    });
  }

  if (haystack.includes("kimi") || haystack.includes("moonshot")) {
    return normalizeConfig({
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: "thinking",
      effortParam: "none",
      effortValueMode: "passthrough",
    });
  }

  if (haystack.includes("glm") || haystack.includes("zhipu") || haystack.includes("z.ai")) {
    return normalizeConfig({
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: "thinking",
      effortParam: "none",
      effortValueMode: "passthrough",
    });
  }

  if (haystack.includes("qwen") || haystack.includes("dashscope")) {
    return normalizeConfig({
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: "enable_thinking",
      effortParam: "none",
      effortValueMode: "passthrough",
    });
  }

  if (haystack.includes("minimax")) {
    return normalizeConfig({
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: "reasoning_split",
      effortParam: "none",
      effortValueMode: "passthrough",
    });
  }

  if (haystack.includes("mimo")) {
    return normalizeConfig({
      supportsThinking: true,
      supportsEffort: false,
      thinkingParam: "thinking",
      effortParam: "none",
      effortValueMode: "passthrough",
    });
  }

  return null;
}

export function resolveCodexChatReasoningConfig(
  baseUrl: string,
  model: string,
  manualMode = "auto",
  providerName = "",
): CodexChatReasoningConfig | null {
  const inferred = inferCodexChatReasoningConfig(baseUrl, model, providerName);
  const mode = (manualMode || "auto").trim().toLowerCase();

  if (mode === "auto") return inferred;

  if (MANUAL_EFFORT_MODES.has(mode)) {
    const base = inferred || {
      supportsThinking: false,
      supportsEffort: false,
      thinkingParam: "none",
      effortParam: "none",
      effortValueMode: "passthrough",
    };
    return normalizeConfig({ ...base, effortValueMode: mode });
  }

  return inferred;
}
