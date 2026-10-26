import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Tray } from "electron";
import path from "path";
import fs from "fs";
import { spawn, exec } from "child_process";
import os from "os";
import { BridgeServer } from "./bridge/server";
import { writeCodexConfig } from "./codex/configStore";
import { isNativeDeepseekUrl } from "./codex/nativeDeepseek";

const LEGACY_ENV_PATH = path.resolve(__dirname, "../..", "codex-bridge", ".env");
const DEFAULT_CODEX_DIR = path.join(os.homedir(), ".codex");

function getEnvPath(): string {
  return path.join(app.getPath("userData"), ".env");
}

function getUpstreamGroupsPath(): string {
  return path.join(app.getPath("userData"), "upstream-groups.json");
}

function readUpstreamGroups(): Record<string, unknown> {
  try {
    const fp = getUpstreamGroupsPath();
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return {};
  }
}

function writeUpstreamGroupsFile(data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(getUpstreamGroupsPath()), { recursive: true });
  fs.writeFileSync(getUpstreamGroupsPath(), JSON.stringify(data, null, 2), "utf-8");
}

let bridgeServer: BridgeServer | null = null;
let mainWindow: any = null;
let codexCheckInterval: NodeJS.Timeout | null = null;
let tray: Electron.Tray | null = null;
let lastCodexRunning = false;
let isQuitting = false;
let appThemeMode: "light" | "dark" | "system" = "system";

// 单实例锁：已运行时重复启动，提示后聚焦已有窗口，新实例直接退出
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    dialog.showMessageBoxSync({
      type: "warning",
      title: "Codex Bridge",
      message: "正在运行，勿重复打开",
    });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function toPowerShellEncodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function queryCodexProcessRunning(): Promise<boolean> {
  if (process.platform !== "win32") {
    return Promise.resolve(false);
  }

  const ps = [
    "$procs = @(Get-CimInstance Win32_Process | Where-Object {",
    "  ($_.Name -match '(?i)^codex\\.exe$') -or",
    "  ($_.ExecutablePath -and $_.ExecutablePath -match '(?i)OpenAI\\.Codex') -or",
    "  ($_.CommandLine -and $_.CommandLine -match '(?i)OpenAI\\.Codex')",
    "})",
    "if ($procs.Count -gt 0) { 'yes' } else { 'no' }",
  ].join(" ");

  const encoded = toPowerShellEncodedCommand(ps);
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { windowsHide: true },
      (err, stdout) => {
        if (err) {
          exec('tasklist /FI "IMAGENAME eq codex.exe" /NH', (err2, stdout2) => {
            if (err2) {
              resolve(false);
              return;
            }
            resolve(stdout2.toLowerCase().includes("codex.exe"));
          });
          return;
        }
        resolve(stdout.trim().toLowerCase() === "yes");
      },
    );
  });
}

function publishCodexRunningState(running: boolean) {
  if (running !== lastCodexRunning) {
    lastCodexRunning = running;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("codex-status", { running });
    }
  }
}

function checkCodexRunning() {
  queryCodexProcessRunning().then(publishCodexRunningState);
}

function scheduleCodexStartupChecks() {
  for (const delay of [500, 1500, 3000, 6000, 10000, 15000]) {
    setTimeout(checkCodexRunning, delay);
  }
}

function sendLog(text: string, level: "info" | "success" | "error" | "warn" = "info") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log-line", { text, level });
  appendToLogFile(text, level);
  }
}


// ─── Log file persistence ───

let _logFilePath: string | null = null;

function getLogDir(): string {
  try {
    return path.join(app.getPath("userData"), "logs");
  } catch {
    return path.join(os.homedir(), "AppData", "Roaming", "codex-bridge", "logs");
  }
}

function getLogFilePath(): string {
  if (_logFilePath) return _logFilePath;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dir = getLogDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _logFilePath = path.join(dir, `bridge-${y}-${m}-${day}.log`);
  return _logFilePath;
}

function appendToLogFile(text: string, level: string): void {
  try {
    const now = new Date();
    const ts = [
      now.getHours().toString().padStart(2, "0"),
      now.getMinutes().toString().padStart(2, "0"),
      now.getSeconds().toString().padStart(2, "0"),
    ].join(":");
    const line = `[${ts}] [${level}] ${text}\n`;
    fs.appendFileSync(getLogFilePath(), line, "utf-8");
  } catch {
    /* best-effort */
  }
}

function readTodayLogs(): { text: string; level: string }[] {
  try {
    const fp = getLogFilePath();
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const recent = lines.slice(-200);
    return recent.map((l) => {
      const m = l.match(/^\[([^\]]+)\] \[([^\]]+)\] (.*)/);
      if (m) return { text: `[${m[1]}] ${m[3]}`, level: m[2] };
      return { text: l, level: "info" };
    }).filter((x) => x.text);
  } catch {
    return [];
  }
}

const TITLE_BAR_HEIGHT = 32;

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, "../build/icon.ico"),
    path.join(__dirname, "../dist/icon.png"),
    path.join(__dirname, "../public/icon.png"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveTrayIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, "../build/icon.ico"),
    path.join(__dirname, "../public/icon.png"),
    path.join(__dirname, "../dist/icon.png"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

const WINDOW_THEME = {
  light: { bg: "#ebebeb", symbol: "#1d1d1f" },
  dark: { bg: "#1e1e1e", symbol: "#ffffff" },
} as const;

function syncNativeThemeSource(mode: string) {
  if (mode === "light" || mode === "dark" || mode === "system") {
    nativeTheme.themeSource = mode;
  }
}

function applyWindowTheme(effective: "light" | "dark") {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const theme = WINDOW_THEME[effective];
  mainWindow.setBackgroundColor(theme.bg);
  if (process.platform === "win32") {
    mainWindow.setTitleBarOverlay({
      color: theme.bg,
      symbolColor: theme.symbol,
      height: TITLE_BAR_HEIGHT,
    });
  }
}

function resolveEffectiveThemeMode(mode: string): "light" | "dark" {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function applyWindowThemeMode(mode: string) {
  syncNativeThemeSource(mode);
  applyWindowTheme(resolveEffectiveThemeMode(mode));
}

function getInitialWindowTheme(): "light" | "dark" {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function createTray() {
  const iconPath = resolveTrayIconPath();
  if (!iconPath) return;

  tray = new Tray(iconPath);
  tray.setToolTip("Codex Bridge");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Codex Bridge",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        stopBridgeGracefully();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const initial = WINDOW_THEME[getInitialWindowTheme()];
  const winOptions: Electron.BrowserWindowConstructorOptions = {
    width: 720,
    height: 720,
    minWidth: 600,
    minHeight: 500,
    title: "Codex Bridge",
    backgroundColor: initial.bg,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (process.platform === "win32") {
    winOptions.titleBarStyle = "hidden";
    winOptions.titleBarOverlay = {
      color: initial.bg,
      symbolColor: initial.symbol,
      height: TITLE_BAR_HEIGHT,
    };
  }

  const iconPath = resolveAppIconPath();
  if (iconPath) {
    winOptions.icon = iconPath;
  }

  mainWindow = new BrowserWindow(winOptions);

  // Minimize to tray instead of taskbar
  mainWindow.on("minimize", (event: Event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on("close", (event: Event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  migrateLegacyEnvIfNeeded();
  createWindow();
  createTray();
  nativeTheme.on("updated", () => {
    if (appThemeMode === "system") {
      applyWindowTheme(resolveEffectiveThemeMode("system"));
    }
  });
  checkCodexRunning();
  codexCheckInterval = setInterval(checkCodexRunning, 3000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function migrateLegacyEnvIfNeeded() {
  const envPath = getEnvPath();
  if (fs.existsSync(envPath)) return;
  if (fs.existsSync(LEGACY_ENV_PATH)) {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.copyFileSync(LEGACY_ENV_PATH, envPath);
    sendLog(`Migrated config from ${LEGACY_ENV_PATH}`, "info");
  }
}

function stopBridgeGracefully() {
  if (bridgeServer) {
    void bridgeServer.stop().finally(() => {
      bridgeServer = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("bridge-status", { running: false });
      }
    });
  }
}

app.on("before-quit", () => {
  isQuitting = true;
  stopBridgeGracefully();
  if (codexCheckInterval) {
    clearInterval(codexCheckInterval);
    codexCheckInterval = null;
  }
});

app.on("window-all-closed", () => {
  stopBridgeGracefully();
  if (process.platform !== "darwin") app.quit();
});

process.on("SIGINT", () => {
  stopBridgeGracefully();
  app.quit();
});

process.on("SIGTERM", () => {
  stopBridgeGracefully();
  app.quit();
});

// ─── Config IPC ──────────────────────────────────────

function parseEnv(): Record<string, string> {
  const data: Record<string, string> = {};
  const envPath = getEnvPath();
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        data[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return data;
}

function writeEnv(data: Record<string, string>) {
  const reasoningMode = data.CODEX_CHAT_REASONING_MODE || "auto";
  const bridgePort = data.BRIDGE_PORT || "8000";

  const lines = [
    `# codex-bridge config - saved ${new Date().toISOString()}`,
    "",
    `UPSTREAM_FORMAT=${data.UPSTREAM_FORMAT || "anthropic"}`,
    `BRIDGE_PORT=${bridgePort}`,
    "",
    `# Anthropic upstream`,
    `ANTHROPIC_AUTH_TOKEN=${data.ANTHROPIC_AUTH_TOKEN || ""}`,
    `ANTHROPIC_MODEL=${data.ANTHROPIC_MODEL || ""}`,
    `ANTHROPIC_BASE_URL=${data.ANTHROPIC_BASE_URL || ""}`,
    "",
    `# OpenAI Chat Completions upstream`,
    `OPENAI_API_KEY=${data.OPENAI_API_KEY || ""}`,
    `OPENAI_MODEL=${data.OPENAI_MODEL || ""}`,
    `OPENAI_BASE_URL=${data.OPENAI_BASE_URL || ""}`,
    "",
    `# Responses (Responses API) upstream`,
    `RESPONSE_API_KEY=${data.RESPONSE_API_KEY || ""}`,
    `RESPONSE_MODEL=${data.RESPONSE_MODEL || ""}`,
    `RESPONSE_BASE_URL=${data.RESPONSE_BASE_URL || ""}`,
    "",
    `# Native DeepSeek Responses upstream`,
    `NATIVE_DEEPSEEK_VIA_BRIDGE=${data.NATIVE_DEEPSEEK_VIA_BRIDGE === "true" ? "true" : "false"}`,
    `NATIVE_DEEPSEEK_WEB_SEARCH=${data.NATIVE_DEEPSEEK_WEB_SEARCH === "live" ? "live" : ""}`,
    "",
    `# Reasoning mode (OpenAI + Anthropic upstream): passthrough | deepseek | openrouter | low_high | auto`,
    `CODEX_CHAT_REASONING_MODE=${reasoningMode}`,
    "",
    `CODEX_CONFIG_PATH=${data.CODEX_CONFIG_PATH || ""}`,
    "",
  ];
  fs.mkdirSync(path.dirname(getEnvPath()), { recursive: true });
  fs.writeFileSync(getEnvPath(), lines.join("\n"), "utf-8");
}

function readEffectiveCodexHome(): string {
  return process.env.CODEX_HOME || DEFAULT_CODEX_DIR;
}

function isNativeDeepseekDirectActive(env: Record<string, string>, tomlText: string): boolean {
  if (env.UPSTREAM_FORMAT !== "response") return false;
  if (env.NATIVE_DEEPSEEK_VIA_BRIDGE === "true") return false;
  if (!isNativeDeepseekUrl(env.RESPONSE_BASE_URL || "", "responses")) return false;
  const top = parseTomlSection(tomlText, "");
  return top.model_provider === "deepseek";
}

function logNativeDirectRestartHint(): void {
  const env = parseEnv();
  const codexDir = env.CODEX_CONFIG_PATH || DEFAULT_CODEX_DIR;
  const tomlPath = path.join(codexDir, "config.toml");
  const tomlText = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, "utf-8") : "";
  if (isNativeDeepseekDirectActive(env, tomlText)) {
    sendLog("Codex 需要完全退出后重新打开才能加载 DeepSeek 直连配置（托盘退出）", "warn");
  }
}

function parseTomlSection(text: string, section: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let inSection = section === "";
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    if (s.startsWith("[")) {
      const sec = s.replace(/\[|\]/g, "").trim();
      inSection = sec === section;
      continue;
    }
    if (inSection) {
      const m = s.match(/^(\w[\w_]*)\s*=\s*(.+)$/);
      if (m) {
        let v = m[2].trim();
        if (v.toLowerCase() === "true") v = "true" as unknown as string;
        else if (v.toLowerCase() === "false") v = "false" as unknown as string;
        else if (v.startsWith('"') || v.startsWith("'")) v = v.slice(1, -1);
        result[m[1]] = v;
      }
    }
  }
  return result;
}

ipcMain.handle("read-config", async () => {
  const env = parseEnv();
  const codexDir = env.CODEX_CONFIG_PATH || DEFAULT_CODEX_DIR;
  const tomlPath = path.join(codexDir, "config.toml");
  let tomlText = "";
  if (fs.existsSync(tomlPath)) {
    tomlText = fs.readFileSync(tomlPath, "utf-8");
  }
  const top = parseTomlSection(tomlText, "");
  const activeProviderName = (top.model_provider as string) || "bridge";
  const activeProvider = parseTomlSection(tomlText, `model_providers.${activeProviderName}`);
  const bridge = parseTomlSection(tomlText, "model_providers.bridge");
  const portSource = Object.keys(activeProvider).length ? activeProvider : bridge;
  const port = typeof portSource.base_url === "string" ? (portSource.base_url.match(/:(\d+)$/)?.[1] || "8000") : "8000";

  const upstreamFormat = env.UPSTREAM_FORMAT || "anthropic";
  return {
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN || "",
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || "",
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL || "",
    OPENAI_MODEL: env.OPENAI_MODEL || "",
    OPENAI_BASE_URL: env.OPENAI_BASE_URL || "",
    OPENAI_API_KEY: env.OPENAI_API_KEY || "",
    RESPONSE_API_KEY: env.RESPONSE_API_KEY || "",
    RESPONSE_BASE_URL: env.RESPONSE_BASE_URL || "",
    RESPONSE_MODEL: env.RESPONSE_MODEL || "",
    NATIVE_DEEPSEEK_VIA_BRIDGE: env.NATIVE_DEEPSEEK_VIA_BRIDGE === "true" ? "true" : "false",
    NATIVE_DEEPSEEK_WEB_SEARCH: env.NATIVE_DEEPSEEK_WEB_SEARCH === "live" ? "live" : "",
    CODEX_CHAT_REASONING_MODE: env.CODEX_CHAT_REASONING_MODE || "auto",
    CODEX_MODEL: (top.model as string) || (upstreamFormat === "openai" ? (env.OPENAI_MODEL || "") : upstreamFormat === "response" ? (env.RESPONSE_MODEL || "") : (env.ANTHROPIC_MODEL || "")),
    CODEX_PROVIDER: (top.model_provider as string) || "bridge",
    BRIDGE_PORT: env.BRIDGE_PORT || port,
    CODEX_CONFIG_PATH: codexDir,
    UPSTREAM_FORMAT: upstreamFormat,
  };
});

ipcMain.handle(
  "write-config",
  async (
    _event,
    payload: Record<string, string>,
    options?: { confirmRemoveConflicts?: boolean },
  ) => {
    const result = await writeCodexConfig({
      payload,
      options,
      userDataDir: app.getPath("userData"),
      defaultCodexDir: DEFAULT_CODEX_DIR,
      effectiveCodexHome: readEffectiveCodexHome(),
      writeEnv,
      log: sendLog,
    });

    if (result.ok) {
      sendLog("Saved .env", "success");
      const parts = [`mode=${result.mode}`, `model=${result.model}`, `provider=${result.provider}`];
      if (result.catalogPath) parts.push(`catalog=${result.catalogPath}`);
      sendLog(`Saved config.toml (${parts.join(", ")})`, "success");
      if (result.backups?.config) {
        sendLog(
          `Backup config.toml: ${result.backups.config.path} sha256=${result.backups.config.sha256}`,
          "info",
        );
      }
      if (result.backups?.catalog) {
        sendLog(
          `Backup models.json: ${result.backups.catalog.path} sha256=${result.backups.catalog.sha256}`,
          "info",
        );
      }
      for (const warning of result.warnings || []) sendLog(`[Codex] ${warning}`, "warn");
      if (result.restartRequired) {
        sendLog("请完全退出 Codex（托盘退出）后重新打开，配置才会生效", "warn");
      }
    } else if (result.code === "conflicts") {
      sendLog("DeepSeek 直连检测到冲突配置，等待确认", "warn");
    } else {
      sendLog(`Save error: ${result.error || "unknown"}`, "error");
    }

    return result;
  },
);

// ─── Upstream groups IPC ─────────────────────────────

ipcMain.handle("read-upstream-groups", async () => readUpstreamGroups());

ipcMain.handle("write-upstream-groups", async (_event, payload: Record<string, unknown>) => {
  try {
    writeUpstreamGroupsFile(payload || {});
    sendLog("Saved upstream groups", "success");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendLog(`Save upstream groups error: ${msg}`, "error");
    return { ok: false, error: msg };
  }
});

// ─── Bridge IPC ──────────────────────────────────────

ipcMain.handle("start-bridge", async () => {
  if (bridgeServer) {
    sendLog("Bridge already running", "warn");
    return { ok: false, error: "Already running" };
  }

  const envFromFile = parseEnv();
  const codexDir = envFromFile.CODEX_CONFIG_PATH || DEFAULT_CODEX_DIR;
  const tomlPath = path.join(codexDir, "config.toml");
  const tomlText = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, "utf-8") : "";
  if (isNativeDeepseekDirectActive(envFromFile, tomlText)) {
    const message =
      "Native DeepSeek 官方直连模式不经过 Bridge；如确需转发，请在配置页勾选“经 Bridge 转发”";
    sendLog(message, "warn");
    return { ok: false, code: "direct_mode", error: message };
  }

  const port = parseInt(envFromFile.BRIDGE_PORT || "8000", 10);
  const upstream = envFromFile.UPSTREAM_FORMAT || "anthropic";

  const bridgeEnv = {
    ...process.env,
    ...envFromFile,
  };

  bridgeServer = new BridgeServer({ port, env: bridgeEnv as Record<string, string> });
  bridgeServer.on("log", (line: string) => {
    sendLog(`[Bridge] ${line}`, "info");
  });

  try {
    await bridgeServer.start();
    sendLog(`Bridge started (port=${port}, upstream=${upstream})`, "success");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("bridge-status", { running: true });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendLog(`Bridge start failed: ${msg}`, "error");
    bridgeServer = null;
    return { ok: false, error: msg };
  }
});

ipcMain.handle("stop-bridge", async () => {
  if (!bridgeServer) {
    sendLog("Bridge not running", "warn");
    return { ok: false, error: "Not running" };
  }
  await bridgeServer.stop();
  bridgeServer = null;
  sendLog("Bridge stopped", "info");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("bridge-status", { running: false });
  }
  return { ok: true };
});

ipcMain.handle("get-bridge-status", async () => {
  return { running: !!bridgeServer };
});

ipcMain.handle("quit-app", async () => {
  stopBridgeGracefully();
  app.quit();
  return { ok: true };
});

ipcMain.handle("get-codex-status", async () => {
  const running = await queryCodexProcessRunning();
  publishCodexRunningState(running);
  return { running };
});

ipcMain.handle("get-initial-logs", async () => readTodayLogs());

ipcMain.handle("set-window-theme", async (_event, mode: string) => {
  if (mode === "light" || mode === "dark" || mode === "system") {
    appThemeMode = mode;
  }
  applyWindowThemeMode(mode);
  return { ok: true };
});

// ─── Launch Codex ────────────────────────────────────

function findCodexExe(): string | null {
  const candidates = [
    path.join("C:", "Program Files", "WindowsApps", "OpenAI.Codex_26.519.11010.0_x64__2p2nqsd0c76g0", "app", "resources", "codex.exe"),
    path.join(os.homedir(), "AppData", "Local", "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Local", "codex", "codex.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // glob fallback
  try {
    const dir = "C:/Program Files/WindowsApps";
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.startsWith("OpenAI.Codex")) {
          const p = path.join(dir, entry, "app", "resources", "codex.exe");
          if (fs.existsSync(p)) return p;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

ipcMain.handle("launch-codex", async () => {
  // Try launching via Windows Store AUMID (no ACL issues, no extra CMD window)
  const aumid = "OpenAI.Codex_2p2nqsd0c76g0!App";
  try {
    spawn("explorer.exe", [`shell:AppsFolder\\${aumid}`], {
      windowsHide: false,
      detached: true,
    });
    sendLog("Launched Codex", "success");
    logNativeDirectRestartHint();
    scheduleCodexStartupChecks();
    checkCodexRunning();
    return { ok: true };
  } catch (e) {
    // Fallback: try direct exe via start cmd /k
    const codex = findCodexExe();
    if (codex) {
      spawn("cmd.exe", ["/c", "start", "cmd", "/k", codex], {
        windowsHide: false,
        detached: true,
      });
      sendLog("Launched Codex (fallback)", "success");
      logNativeDirectRestartHint();
      scheduleCodexStartupChecks();
      checkCodexRunning();
      return { ok: true };
    }
    sendLog("Codex not found. Install from Windows Store first.", "error");
    return { ok: false, error: "Codex not found" };
  }
});
