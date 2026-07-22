import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  readConfig: () => ipcRenderer.invoke("read-config"),
  writeConfig: (config: Record<string, string>) =>
    ipcRenderer.invoke("write-config", config),

  startBridge: () => ipcRenderer.invoke("start-bridge"),
  stopBridge: () => ipcRenderer.invoke("stop-bridge"),
  getBridgeStatus: () => ipcRenderer.invoke("get-bridge-status"),

  launchCodex: () => ipcRenderer.invoke("launch-codex"),
  getInitialLogs: () => ipcRenderer.invoke("get-initial-logs"),

  onLog: (callback: (line: { text: string; level: string }) => void) =>
    ipcRenderer.on("log-line", (_event, value) => callback(value)),
  offLog: () => ipcRenderer.removeAllListeners("log-line"),

  onBridgeStatus: (callback: (status: { running: boolean }) => void) =>
    ipcRenderer.on("bridge-status", (_event, value) => callback(value)),
  offBridgeStatus: () => ipcRenderer.removeAllListeners("bridge-status"),

  quitApp: () => ipcRenderer.invoke("quit-app"),

  getCodexStatus: () => ipcRenderer.invoke("get-codex-status"),
  onCodexStatus: (callback: (status: { running: boolean }) => void) =>
    ipcRenderer.on("codex-status", (_event, value) => callback(value)),
  offCodexStatus: () => ipcRenderer.removeAllListeners("codex-status"),

  setWindowTheme: (mode: "light" | "dark" | "system") =>
    ipcRenderer.invoke("set-window-theme", mode),
  onSystemThemeChanged: (callback: () => void) =>
    ipcRenderer.on("system-theme-changed", () => callback()),
  offSystemThemeChanged: () => ipcRenderer.removeAllListeners("system-theme-changed"),
});
