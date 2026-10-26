import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildCodexConfigPlan,
  CodexConfigPlan,
  CodexMode,
  Conflict,
  DEEPSEEK_CONFLICT_KEYS,
  DEEPSEEK_DIRECT_MANAGED_KEYS,
  PlanResult,
} from "./configPlan";
import { CatalogError, loadOfficialCatalog, mergeDeepSeekCatalog } from "./modelsCatalog";
import {
  getSectionKeyRaw,
  getSectionRaw,
  getTopLevelRaw,
  KeySnapshot,
  parseTomlString,
  removeSection,
  removeSectionKey,
  removeTopLevelKey,
  replaceSection,
  replaceSectionRaw,
  setTopLevelKeys,
  TomlError,
  tomlStringArray,
  upsertSectionKey,
  upsertTopLevelKey,
  validateTomlText,
  writeJsonAtomic,
  writeTextAtomic,
} from "./toml";

const DESKTOP_EFFORTS_KEY = "enabled-reasoning-efforts";
const MANAGED_KEYS = Array.from(
  new Set([...DEEPSEEK_DIRECT_MANAGED_KEYS, ...DEEPSEEK_CONFLICT_KEYS.map((item) => item.key)]),
);

export interface BackupResult {
  path: string;
  sha256: string;
}

export interface WriteConfigOptions {
  confirmRemoveConflicts?: boolean;
}

export interface WriteConfigResult {
  ok: boolean;
  code?: string;
  error?: string;
  mode?: CodexMode;
  model?: string;
  provider?: string;
  catalogPath?: string;
  backups?: { config?: BackupResult; catalog?: BackupResult };
  warnings?: string[];
  conflicts?: Conflict[];
  restartRequired?: boolean;
}

export interface WriteConfigContext {
  payload: Record<string, string>;
  options?: WriteConfigOptions;
  userDataDir: string;
  defaultCodexDir: string;
  effectiveCodexHome: string;
  writeEnv: (payload: Record<string, string>) => void;
  log: (message: string, level?: "info" | "success" | "warn" | "error") => void;
}

interface NativeDeepseekState {
  version: 1;
  configPath: string;
  appliedAt: string;
  topLevel: Record<string, KeySnapshot>;
  desktopEfforts: KeySnapshot;
  deepseekProviderSection: KeySnapshot;
}

type PlanFailure = Extract<PlanResult, { ok: false }>;

function isPlanFailure(result: PlanResult): result is PlanFailure {
  return result.ok === false;
}

let writeQueue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function expandHome(value: string, homedir: string): string {
  if (value === "~") return homedir;
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(homedir, value.slice(2));
  return value;
}

function readTextIfExists(filePath: string): string {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
}

function resolveExistingCatalogPath(text: string, codexDir: string, homedir: string): string | null {
  const snapshot = getTopLevelRaw(text, "model_catalog_json");
  if (!snapshot.exists) return null;
  if (snapshot.raw === undefined) throw new Error("model_catalog_json 缺少值");
  const parsed = parseTomlString(snapshot.raw);
  if (parsed === null || !parsed.trim()) {
    throw new Error("model_catalog_json 不是有效的字符串路径");
  }
  return path.resolve(codexDir, expandHome(parsed.trim(), homedir));
}

function backupFile(filePath: string, backupDir: string, label: string): BackupResult | null {
  if (!fs.existsSync(filePath)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  const dest = path.join(backupDir, `${label}.${stamp}-${suffix}.bak`);
  fs.copyFileSync(filePath, dest);
  try {
    fs.chmodSync(dest, 0o600);
  } catch {
    /* best effort on Windows */
  }
  const data = fs.readFileSync(dest);
  return { path: dest, sha256: crypto.createHash("sha256").update(data).digest("hex") };
}

function pruneBackups(dir: string, prefix: string, keep = 20): void {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
    .sort();
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* ignore */
    }
  }
}

function statePathOf(userDataDir: string): string {
  return path.join(userDataDir, "native-deepseek-state.json");
}

function archiveState(filePath: string, log: WriteConfigContext["log"]): void {
  if (!fs.existsSync(filePath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${filePath}.stale-${stamp}`;
  try {
    fs.renameSync(filePath, dest);
    log(`Sidecar 已归档: ${dest}`, "warn");
  } catch {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }
}

function readState(filePath: string, log: WriteConfigContext["log"]): NativeDeepseekState | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as NativeDeepseekState;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.configPath !== "string" ||
      typeof parsed.topLevel !== "object" ||
      parsed.topLevel === null ||
      typeof parsed.desktopEfforts !== "object" ||
      parsed.desktopEfforts === null ||
      typeof parsed.deepseekProviderSection !== "object" ||
      parsed.deepseekProviderSection === null
    ) {
      throw new Error("sidecar 结构不完整");
    }
    return parsed;
  } catch (error) {
    log(`Native DeepSeek sidecar 无效，已归档: ${messageOf(error)}`, "warn");
    archiveState(filePath, log);
    return null;
  }
}

function writeState(filePath: string, state: NativeDeepseekState): void {
  writeJsonAtomic(filePath, state);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* best effort on Windows */
  }
}

function clearState(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  fs.unlinkSync(filePath);
}

function snapshotState(text: string, configPath: string): NativeDeepseekState {
  const topLevel: Record<string, KeySnapshot> = {};
  for (const key of MANAGED_KEYS) topLevel[key] = getTopLevelRaw(text, key);
  return {
    version: 1,
    configPath,
    appliedAt: new Date().toISOString(),
    topLevel,
    desktopEfforts: getSectionKeyRaw(text, "desktop", DESKTOP_EFFORTS_KEY),
    deepseekProviderSection: getSectionRaw(text, "model_providers.deepseek"),
  };
}

function restoreState(text: string, state: NativeDeepseekState): string {
  let result = text;
  for (const [key, snapshot] of Object.entries(state.topLevel)) {
    if (snapshot && snapshot.exists && snapshot.raw !== undefined) {
      result = upsertTopLevelKey(result, key, snapshot.raw);
    } else {
      result = removeTopLevelKey(result, key);
    }
  }

  const desktop = state.desktopEfforts;
  if (desktop && desktop.exists && desktop.raw !== undefined) {
    result = upsertSectionKey(result, "desktop", DESKTOP_EFFORTS_KEY, desktop.raw);
  } else {
    result = removeSectionKey(result, "desktop", DESKTOP_EFFORTS_KEY);
  }

  const provider = state.deepseekProviderSection;
  if (provider && provider.exists && provider.raw) {
    result = replaceSectionRaw(result, "model_providers.deepseek", provider.raw);
  } else {
    result = removeSection(result, "model_providers.deepseek");
  }
  return result;
}

function applyPlan(text: string, plan: CodexConfigPlan): string {
  let result = setTopLevelKeys(text, plan.topLevel);
  for (const key of plan.topLevelRemove) result = removeTopLevelKey(result, key);
  if (plan.providerSection) {
    if (plan.providerSection.replace) {
      result = replaceSection(
        result,
        plan.providerSection.section,
        plan.providerSection.values.map((entry) => `${entry.key} = ${entry.raw}`),
      );
    } else {
      for (const entry of plan.providerSection.values) {
        result = upsertSectionKey(
          result,
          plan.providerSection.section,
          entry.key,
          entry.raw,
        );
      }
    }
  }
  if (plan.desktopEfforts) {
    result = upsertSectionKey(
      result,
      "desktop",
      DESKTOP_EFFORTS_KEY,
      tomlStringArray(plan.desktopEfforts),
    );
  }
  const errors = validateTomlText(result);
  if (errors.length) throw new TomlError(`生成的 config.toml 校验失败: ${errors.join("; ")}`);
  return result;
}

function readCatalog(target: string): unknown | null {
  if (!fs.existsSync(target)) return null;
  if (fs.statSync(target).isDirectory()) throw new CatalogError(`模型目录路径是目录: ${target}`);
  try {
    return JSON.parse(fs.readFileSync(target, "utf-8"));
  } catch {
    throw new CatalogError(`models.json 不是合法 JSON: ${target}`);
  }
}

async function writeCodexConfigInner(ctx: WriteConfigContext): Promise<WriteConfigResult> {
  const payload = ctx.payload || {};
  const codexDir = path.resolve(payload.CODEX_CONFIG_PATH || ctx.defaultCodexDir);
  if (!fs.existsSync(codexDir) || !fs.statSync(codexDir).isDirectory()) {
    return { ok: false, code: "config_path_missing", error: `Codex config path does not exist: ${codexDir}` };
  }

  const configPath = path.join(codexDir, "config.toml");
  const existingText = readTextIfExists(configPath);
  const existingHash = sha256(existingText);
  const statePath = statePathOf(ctx.userDataDir);
  const backupDir = path.join(codexDir, "backup-deepseek", "codex-bridge");
  const homedir = os.homedir();

  let existingCatalogPath: string | null = null;
  try {
    existingCatalogPath = resolveExistingCatalogPath(existingText, codexDir, homedir);
  } catch (error) {
    return { ok: false, code: "invalid_catalog_path", error: messageOf(error) };
  }
  if (existingCatalogPath && fs.existsSync(existingCatalogPath) && fs.statSync(existingCatalogPath).isDirectory()) {
    return {
      ok: false,
      code: "invalid_catalog_path",
      error: `model_catalog_json 指向目录: ${existingCatalogPath}`,
    };
  }

  const planResult = buildCodexConfigPlan(payload, {
    codexDir,
    effectiveCodexHome: path.resolve(ctx.effectiveCodexHome),
    existingText,
    existingCatalogPath,
    confirmRemoveConflicts: ctx.options?.confirmRemoveConflicts === true,
  });
  if (isPlanFailure(planResult)) {
    return {
      ok: false,
      code: planResult.code,
      error: planResult.error,
      conflicts: planResult.conflicts,
    };
  }
  const plan = planResult.plan;

  let state = readState(statePath, ctx.log);
  let stateWasCreated = false;
  let wroteConfig = false;
  let wroteCatalog = false;
  let originalCatalogText: string | null = null;
  let configBackup: BackupResult | null = null;
  let catalogBackup: BackupResult | null = null;

  try {
    if (state && !samePath(state.configPath, configPath)) {
      archiveState(statePath, ctx.log);
      state = null;
    }

    if (plan.mode === "native-deepseek") {
      if (!state) {
        state = snapshotState(existingText, configPath);
        writeState(statePath, state);
        stateWasCreated = true;
      } else {
        state.appliedAt = new Date().toISOString();
        writeState(statePath, state);
      }

      configBackup = backupFile(configPath, backupDir, "config.toml");
      pruneBackups(backupDir, "config.toml.");

      const catalogTarget = plan.catalogTarget;
      if (!catalogTarget) throw new Error("直连模式缺少模型目录路径");
      const catalogPath = path.normalize(catalogTarget);
      if (!fs.existsSync(path.dirname(catalogPath))) {
        throw new Error(`模型目录所在目录不存在: ${path.dirname(catalogPath)}`);
      }
      if (fs.existsSync(catalogPath) && fs.statSync(catalogPath).isDirectory()) {
        throw new Error(`模型目录路径是目录: ${catalogPath}`);
      }
      catalogBackup = backupFile(catalogPath, backupDir, path.basename(catalogPath));
      pruneBackups(backupDir, `${path.basename(catalogPath)}.`);
      const existingCatalog = readCatalog(catalogPath);
      originalCatalogText = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, "utf-8") : null;
      const { catalog, warnings } = mergeDeepSeekCatalog(existingCatalog, loadOfficialCatalog());
      for (const warning of warnings) plan.warnings.push(warning);
      writeJsonAtomic(catalogPath, catalog);
      wroteCatalog = true;

      const nextText = applyPlan(existingText, plan);
      const latest = readTextIfExists(configPath);
      if (sha256(latest) !== existingHash) {
        throw new Error("config.toml 在保存过程中被外部修改，已中止");
      }
      writeTextAtomic(configPath, nextText);
      wroteConfig = true;
    } else {
      const baseText = state ? restoreState(existingText, state) : existingText;
      configBackup = backupFile(configPath, backupDir, "config.toml");
      pruneBackups(backupDir, "config.toml.");
      const nextText = applyPlan(baseText, plan);
      const latest = readTextIfExists(configPath);
      if (sha256(latest) !== existingHash) {
        throw new Error("config.toml 在保存过程中被外部修改，已中止");
      }
      writeTextAtomic(configPath, nextText);
      wroteConfig = true;
    }

    try {
      ctx.writeEnv(payload);
    } catch (error) {
      return {
        ok: false,
        code: "env_write_error",
        error: `config.toml 已写入，但 .env 保存失败: ${messageOf(error)}`,
        mode: plan.mode,
        model: plan.model,
        provider: plan.provider,
        catalogPath: plan.catalogTarget ?? undefined,
        backups: { config: configBackup ?? undefined, catalog: catalogBackup ?? undefined },
        warnings: plan.warnings,
      };
    }

    if (plan.mode === "bridge" && state) clearState(statePath);

    return {
      ok: true,
      mode: plan.mode,
      model: plan.model,
      provider: plan.provider,
      catalogPath: plan.catalogTarget ?? undefined,
      backups: { config: configBackup ?? undefined, catalog: catalogBackup ?? undefined },
      warnings: plan.warnings,
      restartRequired: plan.restartRequired,
    };
  } catch (error) {
    if (wroteConfig) {
      try {
        writeTextAtomic(configPath, existingText);
      } catch {
        /* ignore */
      }
    }
    if (wroteCatalog) {
      const target = plan.catalogTarget ? path.normalize(plan.catalogTarget) : null;
      if (target) {
        try {
          if (originalCatalogText === null) fs.unlinkSync(target);
          else writeTextAtomic(target, originalCatalogText);
        } catch {
          /* ignore */
        }
      }
    }
    if (stateWasCreated) {
      try {
        clearState(statePath);
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      code: error instanceof CatalogError ? "invalid_catalog" : error instanceof TomlError ? "invalid_toml" : "io_error",
      error: messageOf(error),
      warnings: plan.warnings,
    };
  }
}

export function writeCodexConfig(ctx: WriteConfigContext): Promise<WriteConfigResult> {
  return withLock(() => writeCodexConfigInner(ctx));
}
