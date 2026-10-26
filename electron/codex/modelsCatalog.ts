import officialCatalogJson from "../assets/deepseek-models.json";
import {
  DEEPSEEK_CANONICAL_MODELS,
  DEEPSEEK_FLASH,
  DEEPSEEK_LEGACY_SLUGS,
  DEEPSEEK_V4_PRO,
} from "./nativeDeepseek";

export interface CatalogModel {
  slug: string;
  [key: string]: unknown;
}

export interface ModelCatalog {
  models: CatalogModel[];
  [key: string]: unknown;
}

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

const OFFICIAL_CATALOG = officialCatalogJson as unknown as ModelCatalog;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Source: DeepSeek codex-deepseek-setup.ps1 v1.4.0 (2026-10). Refresh this asset when the docs change.
export function loadOfficialCatalog(): ModelCatalog {
  return clone(OFFICIAL_CATALOG);
}

export function validateOfficialCatalog(catalog: ModelCatalog): void {
  if (!isPlainObject(catalog) || !Array.isArray(catalog.models)) {
    throw new CatalogError("models.json 必须是包含 models 数组的对象");
  }
  if (catalog.models.length !== DEEPSEEK_CANONICAL_MODELS.length) {
    throw new CatalogError(`官方模型目录必须恰好包含 ${DEEPSEEK_CANONICAL_MODELS.join(" 与 ")}`);
  }

  const bySlug = new Map<string, CatalogModel>();
  for (const model of catalog.models) {
    if (!isPlainObject(model) || typeof model.slug !== "string" || !model.slug) {
      throw new CatalogError("官方模型目录中存在缺少 slug 的条目");
    }
    if (!DEEPSEEK_CANONICAL_MODELS.includes(model.slug as (typeof DEEPSEEK_CANONICAL_MODELS)[number])) {
      throw new CatalogError(`官方模型目录包含未知 slug: ${model.slug}`);
    }
    bySlug.set(model.slug, model);
  }

  for (const slug of DEEPSEEK_CANONICAL_MODELS) {
    if (!bySlug.has(slug)) throw new CatalogError(`官方模型目录缺少 ${slug}`);
  }

  for (const model of bySlug.values()) {
    if (model.context_window !== 1048576 || model.max_context_window !== 1048576) {
      throw new CatalogError(`${model.slug} 的上下文窗口不是 1048576`);
    }
    if (model.effective_context_window_percent !== 95) {
      throw new CatalogError(`${model.slug} 的 effective_context_window_percent 不是 95`);
    }
    if (model.supports_reasoning_summaries !== true || model.supports_parallel_tool_calls !== true) {
      throw new CatalogError(`${model.slug} 缺少 reasoning summaries / parallel tool calls 能力`);
    }
    if (model.apply_patch_tool_type !== "freeform" || model.shell_type !== "shell_command") {
      throw new CatalogError(`${model.slug} 的工具类型与官方目录不一致`);
    }
    if (typeof model.minimal_client_version !== "string" || !model.minimal_client_version) {
      throw new CatalogError(`${model.slug} 缺少 minimal_client_version`);
    }
    const levels = Array.isArray(model.supported_reasoning_levels)
      ? model.supported_reasoning_levels
          .filter(isPlainObject)
          .map((entry) => String(entry.effort || ""))
          .sort()
      : [];
    if (levels.join(",") !== "high,low,max") {
      throw new CatalogError(`${model.slug} 的推理档位不是 low/high/max`);
    }
  }

  const flash = bySlug.get(DEEPSEEK_FLASH);
  const pro = bySlug.get(DEEPSEEK_V4_PRO);
  const flashModalities = Array.isArray(flash?.input_modalities) ? flash.input_modalities : [];
  const proModalities = Array.isArray(pro?.input_modalities) ? pro.input_modalities : [];
  if (!flashModalities.includes("image")) throw new CatalogError("deepseek-flash 必须支持图片输入");
  if (proModalities.includes("image")) throw new CatalogError("deepseek-v4-pro 不应声明图片输入");
}

export function mergeDeepSeekCatalog(
  existing: unknown,
  officialCatalog: ModelCatalog = loadOfficialCatalog(),
): { catalog: ModelCatalog; warnings: string[] } {
  validateOfficialCatalog(officialCatalog);
  const warnings: string[] = [];

  if (existing === null || existing === undefined) {
    return { catalog: { models: officialCatalog.models.map(clone) }, warnings };
  }
  if (!isPlainObject(existing) || !Array.isArray(existing.models)) {
    throw new CatalogError("models.json 必须是包含 models 数组的对象");
  }

  const base = existing as ModelCatalog;
  const officialBySlug = new Map(officialCatalog.models.map((model) => [model.slug, model]));
  const seen = new Set<string>();
  const models: CatalogModel[] = [];

  for (let index = 0; index < base.models.length; index += 1) {
    const model = base.models[index];
    if (!isPlainObject(model) || typeof model.slug !== "string" || !model.slug) {
      throw new CatalogError(`models[${index}] 缺少 slug`);
    }
    const slug = model.slug;
    if (DEEPSEEK_LEGACY_SLUGS.includes(slug)) {
      warnings.push(`已移除旧 DeepSeek 模型条目 ${slug}`);
      continue;
    }
    const official = officialBySlug.get(slug);
    if (official) {
      if (seen.has(slug)) {
        warnings.push(`已移除重复的官方模型条目 ${slug}`);
        continue;
      }
      seen.add(slug);
      models.push(clone(official));
      continue;
    }
    if (slug.startsWith("deepseek-")) {
      warnings.push(`保留未知 DeepSeek 模型条目 ${slug}`);
    }
    if (seen.has(slug)) {
      warnings.push(`models.json 存在重复 slug ${slug}，已保留现有条目`);
    }
    seen.add(slug);
    models.push(model as CatalogModel);
  }

  for (const official of officialCatalog.models) {
    if (seen.has(official.slug)) continue;
    seen.add(official.slug);
    models.push(clone(official));
  }

  return { catalog: { ...base, models }, warnings };
}
