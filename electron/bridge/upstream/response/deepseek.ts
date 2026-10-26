import {
  isNativeDeepseekResponsesUrl as isStrictNativeDeepseekResponsesUrl,
  normalizeNativeDeepseekBaseUrl as normalizeNativeDeepseekRoot,
} from "../../../codex/nativeDeepseek";
import { mapReasoningEffort } from "../../reasoning/apply";

export function isNativeDeepseekResponsesUrl(baseUrl: string): boolean {
  return isStrictNativeDeepseekResponsesUrl(baseUrl);
}

export function normalizeNativeDeepseekBaseUrl(baseUrl: string): string {
  return normalizeNativeDeepseekRoot(baseUrl);
}
export function adaptNativeDeepseekPayload(payload: Record<string, unknown>): void {
  const reasoning = payload.reasoning;
  if (typeof reasoning !== "object" || !reasoning) return;
  const obj = reasoning as Record<string, unknown>;
  if (typeof obj.effort !== "string") return;
  const mapped = mapReasoningEffort(obj.effort, "deepseek_responses");
  if (mapped) obj.effort = mapped;
}