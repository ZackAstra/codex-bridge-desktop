const DEEPSEEK_HOST = "api.deepseek.com";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/";
export const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic";
export const DEEPSEEK_FLASH = "deepseek-flash";
export const DEEPSEEK_V4_PRO = "deepseek-v4-pro";
export const DEEPSEEK_CANONICAL_MODELS = [DEEPSEEK_FLASH, DEEPSEEK_V4_PRO] as const;

export type DeepseekProtocol = "responses" | "chat" | "anthropic";

const LEGACY_MODELS: Record<string, string> = {
  "deepseek-v4-flash": DEEPSEEK_FLASH,
  "deepseek-v4-flash-vision-exp": DEEPSEEK_FLASH,
};

export const DEEPSEEK_LEGACY_SLUGS = Object.keys(LEGACY_MODELS);

function normalizedPath(url: URL): string {
  const value = url.pathname.replace(/\/+$/, "");
  return value === "" ? "/" : value;
}

export function isNativeDeepseekHost(raw: string): boolean {
  try {
    const url = new URL(String(raw || "").trim());
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.hostname.toLowerCase() === DEEPSEEK_HOST
    );
  } catch {
    return false;
  }
}

export function isNativeDeepseekUrl(raw: string, protocol: DeepseekProtocol = "responses"): boolean {
  if (!isNativeDeepseekHost(raw)) return false;
  const url = new URL(String(raw).trim());
  if (url.search || url.hash) return false;
  const path = normalizedPath(url);
  if (protocol === "anthropic") return path === "/anthropic";
  if (protocol === "chat") return path === "/" || path === "/v1";
  return path === "/" || path === "/v1" || path === "/responses" || path === "/v1/responses";
}

export function canonicalDeepseekModel(raw: string): string | null {
  const model = String(raw || "").trim().toLowerCase();
  if (!model) return null;
  if (model === DEEPSEEK_FLASH || model === DEEPSEEK_V4_PRO) return model;
  return LEGACY_MODELS[model] ?? null;
}

export function isLegacyDeepseekModel(raw: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_MODELS, String(raw || "").trim().toLowerCase());
}

export function isDeepseekModelName(raw: string): boolean {
  return String(raw || "").toLowerCase().includes("deepseek");
}

export function canonicalDeepseekBaseUrl(protocol: DeepseekProtocol = "responses"): string {
  return protocol === "anthropic" ? DEEPSEEK_ANTHROPIC_BASE_URL : DEEPSEEK_BASE_URL;
}

export function canonicalDeepseekResponsesEndpoint(): string {
  return `${DEEPSEEK_BASE_URL.replace(/\/+$/, "")}/responses`;
}

// Native DeepSeek always uses the root base URL; the Responses endpoint helper appends /responses.
export function normalizeNativeDeepseekBaseUrl(_raw: string): string {
  return DEEPSEEK_BASE_URL;
}

export function isNativeDeepseekResponsesUrl(raw: string): boolean {
  return isNativeDeepseekUrl(raw, "responses");
}
