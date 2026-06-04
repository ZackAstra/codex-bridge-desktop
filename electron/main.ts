import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from "electron";
import path from "path";
import fs from "fs";
import { spawn, exec } from "child_process";
import os from "os";
import { BridgeServer } from "./bridge/server";

const LEGACY_ENV_PATH = path.resolve(__dirname, "../..", "codex-bridge", ".env");
const DEFAULT_CODEX_DIR = path.join(os.homedir(), ".codex");

function getEnvPath(): string {
  return path.join(app.getPath("userData"), ".env");
}

let bridgeServer: BridgeServer | null = null;
let mainWindow: any = null;
let codexCheckInterval: NodeJS.Timeout | null = null;
let lastCodexRunning = false;
let appThemeMode: "light" | "dark" | "system" = "system";

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
  }
}

const TITLE_BAR_HEIGHT = 32;

function resolveAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, "../dist/icon.png"),
    path.join(__dirname, "../build/icon.ico"),
    path.join(__dirname, "../public/icon.png"),
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

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  migrateLegacyEnvIfNeeded();
  createWindow();
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
    `# Reasoning mode (OpenAI + Anthropic upstream): passthrough | deepseek | openrouter | low_high | auto`,
    `CODEX_CHAT_REASONING_MODE=${reasoningMode}`,
    "",
    `CODEX_CONFIG_PATH=${data.CODEX_CONFIG_PATH || ""}`,
    "",
  ];
  fs.mkdirSync(path.dirname(getEnvPath()), { recursive: true });
  fs.writeFileSync(getEnvPath(), lines.join("\n"), "utf-8");
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

function writeTomlValue(text: string, section: string, key: string, value: unknown): string {
  const vs = typeof value === "boolean" ? String(value).toLowerCase()
    : typeof value === "string" && !value.startsWith("'") ? `"${value}"`
    : String(value);

  let lines = text.split(/\r?\n/);
  if (section === "") {
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (new RegExp(`^${key}\\s*=`).test(lines[i].trim())) {
        lines[i] = `${key} = ${vs}`;
        found = true;
        break;
      }
    }
    if (!found) {
      if (lines.length && lines[lines.length - 1].trim()) lines.push("");
      lines.push(`${key} = ${vs}`);
    }
    return lines.join("\n");
  }

  const secHdr = `[${section}]`;
  let inSec = false;
  let found = false;
  let secIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith("[") && !s.startsWith("[[")) {
      if (inSec) break;
      if (s === secHdr) { inSec = true; secIdx = i; }
      continue;
    }
    if (inSec && new RegExp(`^${key}\\s*=`).test(s)) {
      lines[i] = `${key} = ${vs}`;
      found = true;
      break;
    }
  }

  if (!found) {
    if (secIdx >= 0) {
      let ins = secIdx + 1;
      while (ins < lines.length && !lines[ins].trim().startsWith("[") && lines[ins].trim()) ins++;
      lines.splice(ins, 0, `${key} = ${vs}`);
    } else {
      if (lines.length && lines[lines.length - 1].trim()) lines.push("");
      lines.push(secHdr);
      lines.push(`${key} = ${vs}`);
    }
  }
  return lines.join("\n");
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
  const bridge = parseTomlSection(tomlText, "model_providers.bridge");
  const port = typeof bridge.base_url === "string" ? (bridge.base_url.match(/:(\d+)$/)?.[1] || "8000") : "8000";

  const upstreamFormat = env.UPSTREAM_FORMAT || "anthropic";
  const displayBaseUrl =
    upstreamFormat === "openai"
      ? env.OPENAI_BASE_URL || ""
      : env.ANTHROPIC_BASE_URL || "";

  return {
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN || "",
    ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || "",
    ANTHROPIC_BASE_URL: displayBaseUrl,
    OPENAI_MODEL: env.OPENAI_MODEL || "",
    OPENAI_BASE_URL: env.OPENAI_BASE_URL || "",
    OPENAI_API_KEY: env.OPENAI_API_KEY || "",
    CODEX_CHAT_REASONING_MODE: env.CODEX_CHAT_REASONING_MODE || "auto",
    CODEX_MODEL: (top.model as string) || (upstreamFormat === "openai" ? (env.OPENAI_MODEL || "") : (env.ANTHROPIC_MODEL || "")),
    CODEX_PROVIDER: (top.model_provider as string) || "bridge",
    BRIDGE_PORT: env.BRIDGE_PORT || port,
    CODEX_CONFIG_PATH: codexDir,
    UPSTREAM_FORMAT: upstreamFormat,
  };
});

ipcMain.handle("write-config", async (_event, payload: Record<string, string>) => {
  try {
    const codexDir = payload.CODEX_CONFIG_PATH || DEFAULT_CODEX_DIR;
    if (!fs.existsSync(codexDir)) {
      const msg = `Codex config path does not exist: ${codexDir}`;
      sendLog(msg, "error");
      return { ok: false, error: msg };
    }

    writeEnv(payload);
    sendLog("Saved .env", "success");

    const activeModel = payload.UPSTREAM_FORMAT === "openai" ? payload.OPENAI_MODEL : payload.ANTHROPIC_MODEL;
    const model = payload.CODEX_MODEL || activeModel || "";
    const provider = payload.CODEX_PROVIDER || "bridge";
    const port = payload.BRIDGE_PORT || "8000";
    const tomlPath = path.join(codexDir, "config.toml");

    fs.mkdirSync(codexDir, { recursive: true });
    let tomlText = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, "utf-8") : "";
    tomlText = writeTomlValue(tomlText, "", "model", model);
    tomlText = writeTomlValue(tomlText, "", "model_provider", provider);
    const sec = `model_providers.${provider}`;
    tomlText = writeTomlValue(tomlText, sec, "name", model ? `Local Bridge (${model})` : "Local Bridge");
    tomlText = writeTomlValue(tomlText, sec, "base_url", `http://127.0.0.1:${port}`);
    tomlText = writeTomlValue(tomlText, sec, "wire_api", "responses");
    tomlText = writeTomlValue(tomlText, sec, "requires_openai_auth", false);
    tomlText = writeTomlValue(tomlText, sec, "stream_idle_timeout_ms", parseInt(port) || 300000);
    fs.writeFileSync(tomlPath, tomlText + "\n", "utf-8");
    sendLog(`Saved config.toml (model=${model}, provider=${provider}, path=${tomlPath})`, "success");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendLog(`Save error: ${msg}`, "error");
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
      scheduleCodexStartupChecks();
      checkCodexRunning();
      return { ok: true };
    }
    sendLog("Codex not found. Install from Windows Store first.", "error");
    return { ok: false, error: "Codex not found" };
  }
});
