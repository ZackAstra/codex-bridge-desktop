export interface Settings {
  anthropicAuthToken: string;
  anthropicModel: string;
  anthropicBaseUrl: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  upstreamFormat: string;
  codexChatReasoningMode: string;
}

let cachedSettings: Settings | null = null;

export function loadSettings(env: Record<string, string> = process.env as Record<string, string>): Settings {
  const anthropicToken = env.ANTHROPIC_AUTH_TOKEN || "";
  const upstreamFormat = env.UPSTREAM_FORMAT || "anthropic";
  const anthropicBaseUrl = env.ANTHROPIC_BASE_URL || "https://api.minimaxi.com/anthropic";

  const openaiKey = env.OPENAI_API_KEY || anthropicToken;
  let openaiBaseUrl = env.OPENAI_BASE_URL || "";
  if (!openaiBaseUrl) {
    if (upstreamFormat === "openai" && anthropicBaseUrl) {
      openaiBaseUrl = anthropicBaseUrl;
    } else {
      openaiBaseUrl = "https://api.openai.com/v1";
    }
  }

  cachedSettings = {
    anthropicAuthToken: anthropicToken,
    anthropicModel: env.ANTHROPIC_MODEL || "",
    anthropicBaseUrl,
    openaiBaseUrl,
    openaiApiKey: openaiKey,
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
