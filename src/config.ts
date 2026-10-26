export interface ConfigData {
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_BASE_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  RESPONSE_API_KEY: string;
  RESPONSE_BASE_URL: string;
  RESPONSE_MODEL: string;
  NATIVE_DEEPSEEK_VIA_BRIDGE: string;
  NATIVE_DEEPSEEK_WEB_SEARCH: string;
  CODEX_CHAT_REASONING_MODE: string;
  CODEX_MODEL: string;
  CODEX_PROVIDER: string;
  BRIDGE_PORT: string;
  CODEX_CONFIG_PATH: string;
  UPSTREAM_FORMAT: "anthropic" | "openai" | "response";
}

export type Format = ConfigData["UPSTREAM_FORMAT"];

export interface UpstreamGroup {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  selectedAt: number;
}

export type UpstreamGroupMap = Record<Format, UpstreamGroup[]>;

export interface GroupValues {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export const EMPTY_GROUPS: UpstreamGroupMap = {
  anthropic: [],
  openai: [],
  response: [],
};

export const DEEPSEEK_WEB_SEARCH_MODEL = "deepseek-v4-pro";

export type DeepseekUiProtocol = "responses" | "chat" | "anthropic";

export function isNativeDeepseekUrl(
  raw: string,
  protocol: DeepseekUiProtocol = "responses",
): boolean {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    if (url.hostname.toLowerCase() !== "api.deepseek.com") return false;
    if (url.search || url.hash) return false;
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (protocol === "anthropic") return path === "/anthropic";
    if (protocol === "chat") return path === "/" || path === "/v1";
    return ["/", "/v1", "/responses", "/v1/responses"].includes(path);
  } catch {
    return false;
  }
}

export function canonicalDeepseekModel(raw: string): string | null {
  const model = String(raw || "").trim().toLowerCase();
  if (model === "deepseek-flash" || model === "deepseek-v4-pro") return model;
  if (model === "deepseek-v4-flash" || model === "deepseek-v4-flash-vision-exp") {
    return "deepseek-flash";
  }
  return null;
}

export const FORMAT_KEYS = {
  anthropic: {
    apiKey: "ANTHROPIC_AUTH_TOKEN",
    model: "ANTHROPIC_MODEL",
    baseUrl: "ANTHROPIC_BASE_URL",
  },
  openai: {
    apiKey: "OPENAI_API_KEY",
    model: "OPENAI_MODEL",
    baseUrl: "OPENAI_BASE_URL",
  },
  response: {
    apiKey: "RESPONSE_API_KEY",
    model: "RESPONSE_MODEL",
    baseUrl: "RESPONSE_BASE_URL",
  },
} as const;

export function formatValues(config: ConfigData, format: Format): GroupValues {
  const keys = FORMAT_KEYS[format];
  return {
    apiKey: config[keys.apiKey] || "",
    model: config[keys.model] || "",
    baseUrl: config[keys.baseUrl] || "",
  };
}

export function normalizeGroups(raw: Record<string, unknown> | null | undefined): UpstreamGroupMap {
  const result: UpstreamGroupMap = { anthropic: [], openai: [], response: [] };
  (["anthropic", "openai", "response"] as const).forEach((key) => {
    const arr = raw?.[key];
    if (Array.isArray(arr)) {
      result[key] = arr
        .filter(
          (g): g is Record<string, unknown> =>
            !!g && typeof g === "object" && typeof (g as UpstreamGroup).name === "string",
        )
        .map((g) => ({
          id: String(g.id || ""),
          name: String(g.name),
          apiKey: String(g.apiKey || ""),
          model: String(g.model || ""),
          baseUrl: String(g.baseUrl || ""),
          selectedAt: Number(g.selectedAt) || 0,
        }));
    }
  });
  return result;
}

export function findGroup(
  groups: UpstreamGroupMap,
  format: Format,
  id: string | null,
): UpstreamGroup | undefined {
  if (!id) return undefined;
  return (groups[format] || []).find((g) => g.id === id);
}

export function isGroupDirty(
  config: ConfigData,
  group: UpstreamGroup | undefined,
  format: Format,
): boolean {
  if (!group) return false;
  const values = formatValues(config, format);
  return (
    values.apiKey !== group.apiKey ||
    values.model !== group.model ||
    values.baseUrl !== group.baseUrl
  );
}

export function matchAppliedGroup(
  groups: UpstreamGroupMap,
  format: Format,
  config: ConfigData,
): UpstreamGroup | undefined {
  const values = formatValues(config, format);
  let best: UpstreamGroup | undefined;
  for (const group of groups[format] || []) {
    if (
      group.apiKey === values.apiKey &&
      group.model === values.model &&
      group.baseUrl === values.baseUrl
    ) {
      if (!best || group.selectedAt > best.selectedAt) best = group;
    }
  }
  return best;
}

export function nextGroupName(list: UpstreamGroup[]): string {
  const used = new Set(list.map((g) => g.name));
  let n = 1;
  while (used.has(`新分组${n}`)) n += 1;
  return `新分组${n}`;
}

export function genGroupId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueName(
  rawName: string,
  list: UpstreamGroup[],
  excludeId?: string,
): string {
  const others = excludeId ? list.filter((g) => g.id !== excludeId) : list;
  const base = rawName.trim() || nextGroupName(others);
  const used = new Set(others.map((g) => g.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

export function createGroup(
  groups: UpstreamGroupMap,
  format: Format,
  rawName: string,
  config: ConfigData,
  now: number,
): { groups: UpstreamGroupMap; group: UpstreamGroup } {
  const list = groups[format] || [];
  const group: UpstreamGroup = {
    id: genGroupId(),
    name: uniqueName(rawName, list),
    ...formatValues(config, format),
    selectedAt: now,
  };
  return { groups: { ...groups, [format]: [...list, group] }, group };
}

export function renameGroup(
  groups: UpstreamGroupMap,
  format: Format,
  id: string,
  rawName: string,
): UpstreamGroupMap {
  const list = groups[format] || [];
  const target = list.find((g) => g.id === id);
  if (!target) return groups;
  const name = uniqueName(rawName.trim() || target.name, list, id);
  if (name === target.name) return groups;
  return {
    ...groups,
    [format]: list.map((g) => (g.id === id ? { ...g, name } : g)),
  };
}

export function upsertGroupValues(
  groups: UpstreamGroupMap,
  format: Format,
  id: string,
  config: ConfigData,
  now: number,
): UpstreamGroupMap {
  const list = groups[format] || [];
  if (!list.some((g) => g.id === id)) return groups;
  const values = formatValues(config, format);
  return {
    ...groups,
    [format]: list.map((g) =>
      g.id === id ? { ...g, ...values, selectedAt: now } : g,
    ),
  };
}

export function removeGroup(
  groups: UpstreamGroupMap,
  format: Format,
  id: string,
): UpstreamGroupMap {
  return {
    ...groups,
    [format]: (groups[format] || []).filter((g) => g.id !== id),
  };
}
