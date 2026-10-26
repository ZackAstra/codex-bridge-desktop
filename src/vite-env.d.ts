/// <reference types="vite/client" />

interface WriteConfigOptions {
  confirmRemoveConflicts?: boolean;
}

interface WriteConfigBackup {
  path: string;
  sha256: string;
}

interface WriteConfigResult {
  ok: boolean;
  code?: string;
  error?: string;
  mode?: "bridge" | "native-deepseek";
  model?: string;
  provider?: string;
  catalogPath?: string;
  backups?: { config?: WriteConfigBackup; catalog?: WriteConfigBackup };
  warnings?: string[];
  conflicts?: { key: string; reason: string }[];
  restartRequired?: boolean;
}

interface Window {
  electronAPI: {
    readConfig: () => Promise<Record<string, string>>;
    writeConfig: (
      config: Record<string, string>,
      options?: WriteConfigOptions,
    ) => Promise<WriteConfigResult>;
    readUpstreamGroups: () => Promise<Record<string, unknown>>;
    writeUpstreamGroups: (groups: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
    startBridge: () => Promise<{ ok: boolean; code?: string; error?: string }>;
    stopBridge: () => Promise<{ ok: boolean; code?: string; error?: string }>;
    getBridgeStatus: () => Promise<{ running: boolean }>;
    launchCodex: () => Promise<{ ok: boolean; error?: string }>;
    getInitialLogs: () => Promise<{ text: string; level: string }[]>;
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
