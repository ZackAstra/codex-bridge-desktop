import path from "path";
import {
  canonicalDeepseekModel,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_CANONICAL_MODELS,
  DEEPSEEK_FLASH,
  DEEPSEEK_V4_PRO,
  isDeepseekModelName,
  isLegacyDeepseekModel,
  isNativeDeepseekUrl,
} from "./nativeDeepseek";
import { hasTopLevelKey, listSections, tomlString } from "./toml";

export type CodexMode = "bridge" | "native-deepseek";

export interface Conflict {
  key: string;
  reason: string;
}

export interface TomlEntry {
  key: string;
  raw: string;
}

export interface PlannedSection {
  section: string;
  values: TomlEntry[];
  replace: boolean;
}

export interface CodexConfigPlan {
  mode: CodexMode;
  model: string;
  provider: string;
  configPath: string;
  catalogTarget: string | null;
  topLevel: TomlEntry[];
  topLevelRemove: string[];
  providerSection: PlannedSection | null;
  desktopEfforts: string[] | null;
  conflicts: Conflict[];
  warnings: string[];
  restartRequired: boolean;
  directApiKey?: string;
}

export type PlanErrorCode =
  | "conflicts"
  | "invalid_model"
  | "missing_key"
  | "invalid_key"
  | "path_mismatch"
  | "invalid_catalog_path";

export type PlanResult =
  | { ok: true; plan: CodexConfigPlan }
  | { ok: false; code: PlanErrorCode; error: string; conflicts?: Conflict[] };

export interface PlanOptions {
  codexDir: string;
  effectiveCodexHome: string;
  existingText: string;
  existingCatalogPath: string | null;
  confirmRemoveConflicts: boolean;
}

export const DEEPSEEK_CONFLICT_KEYS: Conflict[] = [
  { key: "profile", reason: "profile 会遮蔽 model / model_provider / model_catalog_json" },
  { key: "oss_provider", reason: "备用 provider 选择器，会把请求重定向到别处" },
  { key: "openai_base_url", reason: "全局 base_url 覆盖，会劫持请求" },
  {
    key: "model_context_window",
    reason: "覆盖 models.json 的 1M 上下文，可能导致自动压缩不触发",
  },
  { key: "model_auto_compact_token_limit", reason: "覆盖自动压缩时机" },
  { key: "model_auto_compact_token_limit_scope", reason: "覆盖自动压缩时机" },
  { key: "base_instructions", reason: "覆盖 models.json 的 base_instructions" },
  { key: "model_instructions_file", reason: "覆盖 models.json 的 base_instructions" },
  { key: "compact_prompt", reason: "覆盖上下文压缩提示词" },
  { key: "experimental_compact_prompt_file", reason: "覆盖上下文压缩提示词" },
  { key: "service_tier", reason: "残留值可能作为参数发给 API 并导致 400" },
  { key: "model_verbosity", reason: "残留值可能超出模型支持范围" },
  {
    key: "model_reasoning_summary",
    reason: "models.json 声明 default_reasoning_summary=none，残留值会发送 reasoning.summary",
  },
  { key: "plan_mode_reasoning_effort", reason: "可能是 xhigh，而模型只声明 low/high/max" },
  {
    key: "experimental_use_unified_exec_tool",
    reason: "与 models.json 的 shell_type=shell_command 冲突",
  },
];

export const DEEPSEEK_DIRECT_MANAGED_KEYS = [
  "preferred_auth_method",
  "forced_login_method",
  "model_reasoning_effort",
  "web_search",
  "show_raw_agent_reasoning",
  // model_catalog_json is shared across modes so bridge mode keeps model metadata.
];

const DESKTOP_EFFORTS = ["low", "medium", "high", "xhigh", "ultra", "max"];

function value(payload: Record<string, string>, key: string): string {
  const raw = payload[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function toTomlPath(valueToFormat: string): string {
  return valueToFormat.replace(/\\/g, "/");
}

export function buildCodexConfigPlan(
  payload: Record<string, string>,
  options: PlanOptions,
): PlanResult {
  const format = value(payload, "UPSTREAM_FORMAT");
  const responseBaseUrl = value(payload, "RESPONSE_BASE_URL");
  const nativeResponse = format === "response" && isNativeDeepseekUrl(responseBaseUrl, "responses");
  const viaBridge = value(payload, "NATIVE_DEEPSEEK_VIA_BRIDGE") === "true";
  const warnings: string[] = [];
  const configPath = path.join(options.codexDir, "config.toml");

  if (!samePath(options.codexDir, options.effectiveCodexHome)) {
    const message =
      `Codex Config Path (${options.codexDir}) 与 Codex 实际读取路径 (${options.effectiveCodexHome}) 不一致。` +
      " Store 版 Codex 通过 AUMID 启动，无法注入 CODEX_HOME；请把路径改为 ~/.codex 或设置 CODEX_HOME。";
    if (nativeResponse && !viaBridge) {
      return { ok: false, code: "path_mismatch", error: message };
    }
    warnings.push(message);
  }

  if (nativeResponse && !viaBridge) {
    return planNativeDirect(payload, options, configPath, warnings);
  }
  return planBridge(payload, options, configPath, nativeResponse, viaBridge, warnings);
}

function planNativeDirect(
  payload: Record<string, string>,
  options: PlanOptions,
  configPath: string,
  warnings: string[],
): PlanResult {
  const upstreamModel = value(payload, "RESPONSE_MODEL");
  const codexModel = value(payload, "CODEX_MODEL");
  const modelInput = upstreamModel || codexModel || DEEPSEEK_FLASH;
  const model = canonicalDeepseekModel(modelInput);

  if (!model) {
    return {
      ok: false,
      code: "invalid_model",
      error:
        `原生 DeepSeek 官方模型目录仅支持 ${DEEPSEEK_CANONICAL_MODELS.join(" / ")}；` +
        `当前模型为 "${modelInput}"。旧名 deepseek-v4-flash、deepseek-v4-flash-vision-exp 会自动映射为 deepseek-flash。`,
    };
  }

  const apiKey = value(payload, "RESPONSE_API_KEY");
  if (!apiKey) {
    return { ok: false, code: "missing_key", error: "Responses API Key 为空，无法写入 experimental_bearer_token" };
  }
  if (/["\r\n]/.test(apiKey)) {
    return { ok: false, code: "invalid_key", error: "API Key 不能包含双引号或换行符" };
  }

  const conflicts = DEEPSEEK_CONFLICT_KEYS.filter((conflict) =>
    hasTopLevelKey(options.existingText, conflict.key),
  );
  if (conflicts.length && !options.confirmRemoveConflicts) {
    return {
      ok: false,
      code: "conflicts",
      error: "检测到会覆盖 DeepSeek 官方配置的键；确认移除后才能启用直连",
      conflicts,
    };
  }

  if (!upstreamModel) {
    warnings.push(`RESPONSE_MODEL 为空，直连使用 ${model}`);
  }
  if (codexModel && canonicalDeepseekModel(codexModel) !== model) {
    warnings.push(`直连模式使用上游模型 ${model}，已忽略 Codex Default Model "${codexModel}"`);
  }
  if (isLegacyDeepseekModel(modelInput)) {
    warnings.push(`旧模型名 ${modelInput} 已映射为 ${model}`);
  }
  if (!apiKey.startsWith("sk-")) {
    warnings.push("API Key 不以 sk- 开头；DeepSeek 官方 Key 通常以 sk- 开头");
  }

  const sections = listSections(options.existingText);
  if (sections.some((section) => section === "profiles" || section.startsWith("profiles."))) {
    warnings.push("保留 [profiles.*] 段；顶层 profile 已移除，段本身不再生效");
  }
  if (sections.includes("auto_review")) {
    warnings.push("[auto_review] 已保留；若指向 GPT 模型可能使用 fallback 元数据");
  }

  const sourceCatalog = options.existingCatalogPath
    ? path.resolve(options.existingCatalogPath)
    : path.join(options.codexDir, "models.json");
  const catalogTarget = toTomlPath(sourceCatalog);
  const webSearch =
    model === DEEPSEEK_V4_PRO && value(payload, "NATIVE_DEEPSEEK_WEB_SEARCH") === "live"
      ? "live"
      : "disabled";

  return {
    ok: true,
    plan: {
      mode: "native-deepseek",
      model,
      provider: "deepseek",
      configPath,
      catalogTarget,
      topLevel: [
        { key: "model", raw: tomlString(model) },
        { key: "model_provider", raw: tomlString("deepseek") },
        { key: "preferred_auth_method", raw: tomlString("apikey") },
        { key: "forced_login_method", raw: tomlString("api") },
        { key: "model_reasoning_effort", raw: tomlString("high") },
        { key: "web_search", raw: tomlString(webSearch) },
        { key: "show_raw_agent_reasoning", raw: "true" },
        { key: "model_catalog_json", raw: tomlString(catalogTarget) },
      ],
      topLevelRemove: conflicts.map((conflict) => conflict.key),
      providerSection: {
        section: "model_providers.deepseek",
        replace: true,
        values: [
          { key: "name", raw: tomlString("deepseek") },
          { key: "base_url", raw: tomlString(DEEPSEEK_BASE_URL) },
          { key: "wire_api", raw: tomlString("responses") },
          { key: "experimental_bearer_token", raw: tomlString(apiKey) },
        ],
      },
      desktopEfforts: [...DESKTOP_EFFORTS],
      conflicts,
      warnings,
      restartRequired: true,
      directApiKey: apiKey,
    },
  };
}

function planBridge(
  payload: Record<string, string>,
  options: PlanOptions,
  configPath: string,
  nativeResponse: boolean,
  viaBridge: boolean,
  warnings: string[],
): PlanResult {
  const format = value(payload, "UPSTREAM_FORMAT");
  const activeModel =
    format === "openai"
      ? value(payload, "OPENAI_MODEL")
      : format === "response"
        ? value(payload, "RESPONSE_MODEL")
        : value(payload, "ANTHROPIC_MODEL");
  const model = value(payload, "CODEX_MODEL") || activeModel || "";

  let provider = value(payload, "CODEX_PROVIDER") || "bridge";
  if (provider === "deepseek") {
    provider = "bridge";
    warnings.push("Bridge 模式不能使用保留的 provider 名 deepseek，已改为 bridge");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(provider)) {
    warnings.push(`Provider 名 "${provider}" 含非法字符，已改为 bridge`);
    provider = "bridge";
  }

  const portRaw = value(payload, "BRIDGE_PORT") || "8000";
  const parsedPort = Number.parseInt(portRaw, 10);
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 8000;
  if (port !== parsedPort) warnings.push(`Bridge Port "${portRaw}" 无效，已使用 8000`);

  if (!model) warnings.push("Default Model 为空；Codex 可能无法选择模型");

  if (nativeResponse && viaBridge) {
    warnings.push("原生 DeepSeek 已选择经 Bridge 转发；直连专属键会从 sidecar 恢复");
  } else if (format === "response" && isDeepseekModelName(value(payload, "RESPONSE_MODEL"))) {
    warnings.push("非原生 DeepSeek 域名：自动推理模式不会套用官方规则；可在 Reasoning Mode 手动选择 DeepSeek");
  }
  if (format === "openai" && isNativeDeepseekUrl(value(payload, "OPENAI_BASE_URL"), "chat")) {
    warnings.push("原生 DeepSeek Chat 仍需经 Bridge 转换为 Responses");
  }
  if (format === "anthropic" && isNativeDeepseekUrl(value(payload, "ANTHROPIC_BASE_URL"), "anthropic")) {
    warnings.push("原生 DeepSeek Anthropic 仍需经 Bridge 转换为 Responses");
  }

  return {
    ok: true,
    plan: {
      mode: "bridge",
      model,
      provider,
      configPath,
      catalogTarget: null,
      topLevel: [
        { key: "model", raw: tomlString(model) },
        { key: "model_provider", raw: tomlString(provider) },
      ],
      topLevelRemove: [],
      providerSection: {
        section: `model_providers.${provider}`,
        replace: false,
        values: [
          { key: "name", raw: tomlString(model ? `Local Bridge (${model})` : "Local Bridge") },
          { key: "base_url", raw: tomlString(`http://127.0.0.1:${port}`) },
          { key: "wire_api", raw: tomlString("responses") },
          { key: "requires_openai_auth", raw: "false" },
          { key: "stream_idle_timeout_ms", raw: "300000" },
        ],
      },
      desktopEfforts: null,
      conflicts: [],
      warnings,
      restartRequired: true,
    },
  };
}
