/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    readConfig: () => Promise<Record<string, string>>;
    writeConfig: (config: Record<string, string>) => Promise<{ ok: boolean; error?: string }>;
    startBridge: () => Promise<{ ok: boolean; error?: string }>;
    stopBridge: () => Promise<{ ok: boolean; error?: string }>;
    getBridgeStatus: () => Promise<{ running: boolean }>;
    launchCodex: () => Promise<{ ok: boolean; error?: string }>;
    onLog: (callback: (line: any) => void) => void;
    offLog: () => void;
    onBridgeStatus: (callback: (status: { running: boolean }) => void) => void;
    offBridgeStatus: () => void;
    quitApp: () => Promise<{ ok: boolean; error?: string }>;

    getCodexStatus: () => Promise<{ running: boolean }>;
    onCodexStatus: (callback: (status: { running: boolean }) => void) => void;
    offCodexStatus: () => void;
    setWindowTheme: (mode: "light" | "dark" | "system") => Promise<{ ok: boolean }>;
  };
}
