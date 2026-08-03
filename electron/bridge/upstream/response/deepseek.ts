import { mapReasoningEffort } from "../../reasoning/apply";

const DEEPSEEK_API_HOST = "api.deepseek.com";

export function isNativeDeepseekResponsesUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === DEEPSEEK_API_HOST;
  } catch {
    return false;
  }
}

export function normalizeNativeDeepseekBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.toLowerCase().endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}
export function adaptNativeDeepseekPayload(payload: Record<string, unknown>): void {
  const reasoning = payload.reasoning;
  if (typeof reasoning !== "object" || !reasoning) return;
  const obj = reasoning as Record<string, unknown>;
  if (typeof obj.effort !== "string") return;
  const mapped = mapReasoningEffort(obj.effort, "deepseek_responses");
  if (mapped) obj.effort = mapped;
}