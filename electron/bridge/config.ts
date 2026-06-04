export interface Settings {
  anthropicAuthToken: string;
  anthropicModel: string;
  anthropicBaseUrl: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  upstreamFormat: string;
  codexChatReasoningMode: string;
}

let cachedSettings: Settings | null = null;

export function loadSettings(env: Record<string, string> = process.env as Record<string, string>): Settings {
  const upstreamFormat = env.UPSTREAM_FORMAT || "anthropic";

  // Populate active upstream fields based on the selected tab
  const isOpenAI = upstreamFormat === "openai";

  const anthropicAuthToken = isOpenAI ? (env.OPENAI_API_KEY || "") : (env.ANTHROPIC_AUTH_TOKEN || "");
  const anthropicModel = isOpenAI ? (env.OPENAI_MODEL || "") : (env.ANTHROPIC_MODEL || "");
  const anthropicBaseUrl = isOpenAI
    ? (env.OPENAI_BASE_URL || "https://api.deepseek.com/v1")
    : (env.ANTHROPIC_BASE_URL || "https://api.minimaxi.com/anthropic");

  const openaiApiKey = env.OPENAI_API_KEY || "";
  const openaiBaseUrl = env.OPENAI_BASE_URL || "";
  const openaiModel = env.OPENAI_MODEL || "";

  cachedSettings = {
    anthropicAuthToken,
    anthropicModel,
    anthropicBaseUrl,
    openaiBaseUrl,
    openaiApiKey,
    openaiModel,
    upstreamFormat,
    codexChatReasoningMode: env.CODEX_CHAT_REASONING_MODE || "auto",
  };
  return cachedSettings;
}

export function getSettings(): Settings {
  if (!cachedSettings) {
    return loadSettings();
  }
  return cachedSettings;
}

export function clearSettingsCache(): void {
  cachedSettings = null;
}
