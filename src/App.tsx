import React, { useEffect, useRef, useState, useCallback } from "react";
import ConfigCard from "./components/ConfigCard";
import LogPanel from "./components/LogPanel";
import {
  SunIcon,
  MoonIcon,
  MonitorIcon,
  ConfigIcon,
  LogIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "./components/Icons";

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
  CODEX_CHAT_REASONING_MODE: string;
  CODEX_MODEL: string;
  CODEX_PROVIDER: string;
  BRIDGE_PORT: string;
  CODEX_CONFIG_PATH: string;
  UPSTREAM_FORMAT: "anthropic" | "openai" | "response";
}

export interface UpstreamGroup {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  selectedAt: number;
}

export type UpstreamGroupMap = {
  anthropic: UpstreamGroup[];
  openai: UpstreamGroup[];
  response: UpstreamGroup[];
};

export const EMPTY_GROUPS: UpstreamGroupMap = {
  anthropic: [],
  openai: [],
  response: [],
};

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

function normalizeGroups(raw: Record<string, unknown>): UpstreamGroupMap {
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

export interface LogLine {
  text: string;
  level: "info" | "success" | "error" | "warn";
  origin?: "file" | "live";
}

type ThemeMode = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "codex-bridge-theme";
const SIDEBAR_STORAGE_KEY = "codex-bridge-sidebar-collapsed";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
  window.electronAPI?.setWindowTheme(mode);
}

const THEME_ICON_CMP: Record<ThemeMode, React.FC<{ size?: number }>> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

function App() {
  const [config, setConfig] = useState<ConfigData>({
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_MODEL: "",
    ANTHROPIC_BASE_URL: "",
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
    OPENAI_MODEL: "",
    RESPONSE_API_KEY: "",
    RESPONSE_BASE_URL: "",
    RESPONSE_MODEL: "",
    CODEX_CHAT_REASONING_MODE: "auto",
    CODEX_MODEL: "",
    CODEX_PROVIDER: "bridge",
    BRIDGE_PORT: "8000",
    CODEX_CONFIG_PATH: "",
    UPSTREAM_FORMAT: "anthropic",
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [upstreamGroups, setUpstreamGroups] = useState<UpstreamGroupMap>(EMPTY_GROUPS);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [bridgeRunning, setBridgeRunning] = useState(false);
  const [codexRunning, setCodexRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "logs">("config");
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    return saved && ["light", "dark", "system"].includes(saved) ? saved : "system";
  });
  const [themeOpen, setThemeOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  });
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
    if (sidebarCollapsed) {
      setThemeOpen(false);
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setThemeOpen(false);
      }
    };
    if (themeOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [themeOpen]);

  useEffect(() => {
    if (bridgeRunning) {
      setActiveTab("logs");
    } else {
      setActiveTab("config");
    }
  }, [bridgeRunning]);

  useEffect(() => {
    Promise.all([window.electronAPI.readConfig(), window.electronAPI.readUpstreamGroups()]).then(
      ([cfg, rawGroups]) => {
        const groups = normalizeGroups(rawGroups);
        const format: ConfigData["UPSTREAM_FORMAT"] =
          (cfg.UPSTREAM_FORMAT as ConfigData["UPSTREAM_FORMAT"]) || "anthropic";
        let activeId: string | null = null;
        const list = groups[format] || [];
        let merged: Record<string, string> = { ...cfg };
        if (list.length > 0) {
          const recent = [...list].sort((a, b) => b.selectedAt - a.selectedAt)[0];
          activeId = recent.id;
          const keys = FORMAT_KEYS[format];
          merged = {
            ...merged,
            [keys.apiKey]: recent.apiKey,
            [keys.model]: recent.model,
            [keys.baseUrl]: recent.baseUrl,
          };
        }
        setConfig((prev) => ({
          ...prev,
          ...merged,
          UPSTREAM_FORMAT: format,
          CODEX_CHAT_REASONING_MODE: merged.CODEX_CHAT_REASONING_MODE || prev.CODEX_CHAT_REASONING_MODE,
        }));
        setUpstreamGroups(groups);
        setActiveGroupId(activeId);
        addLog("Loaded existing config", "info");
      },
    );

    window.electronAPI.getBridgeStatus().then((s: { running: boolean }) => {
      setBridgeRunning(s.running);
    });

    window.electronAPI.onLog((line: LogLine) => {
      addLog(line.text, line.level);
    });

    window.electronAPI.onBridgeStatus((status: { running: boolean }) => {
      setBridgeRunning(status.running);
    });

    window.electronAPI.getCodexStatus().then((s: { running: boolean }) => {
      setCodexRunning(s.running);
    });

    window.electronAPI.getInitialLogs().then((lines) => {
      if (lines.length > 0) {
        setLogs(lines.map((l) => ({ text: l.text, level: l.level as LogLine["level"], origin: "file" as const })));
      }
    });

    window.electronAPI.onCodexStatus((status: { running: boolean }) => {
      setCodexRunning(status.running);
    });

    return () => {
      window.electronAPI.offLog();
      window.electronAPI.offBridgeStatus();
      window.electronAPI.offCodexStatus();
    };
  }, []);

  const addLog = useCallback((text: string, level: "info" | "success" | "error" | "warn" = "info") => {
    setLogs((prev) => [...prev.slice(-200), { text, level, origin: "live" as const }]);
  }, []);

  const handleSave = async (cfg: ConfigData) => {
    await window.electronAPI.writeConfig(cfg as unknown as Record<string, string>);
    addLog("Config saved", "success");
  };

  const handleGroupsChange = (next: UpstreamGroupMap) => {
    setUpstreamGroups(next);
    void window.electronAPI.writeUpstreamGroups(next as unknown as Record<string, unknown>);
  };

  const handleSelectGroup = (format: ConfigData["UPSTREAM_FORMAT"], group: UpstreamGroup) => {
    setActiveGroupId(group.id);
    const keys = FORMAT_KEYS[format];
    setConfig((prev) => ({
      ...prev,
      [keys.apiKey]: group.apiKey,
      [keys.model]: group.model,
      [keys.baseUrl]: group.baseUrl,
    }));
    const next = {
      ...upstreamGroups,
      [format]: (upstreamGroups[format] || []).map((g) =>
        g.id === group.id ? { ...g, selectedAt: Date.now() } : g,
      ),
    };
    setUpstreamGroups(next);
    void window.electronAPI.writeUpstreamGroups(next as unknown as Record<string, unknown>);
  };

  const toggleBridge = async () => {
    if (bridgeRunning) {
      await window.electronAPI.stopBridge();
    } else {
      await window.electronAPI.writeConfig(config as unknown as Record<string, string>);
      await window.electronAPI.startBridge();
    }
  };

  const handleLaunchCodex = async () => {
    await window.electronAPI.writeConfig(config as unknown as Record<string, string>);
    const result = await window.electronAPI.launchCodex();
    if (result.ok) {
      addLog("Launched Codex", "success");
    } else {
      addLog(`Launch failed: ${result.error}`, "error");
    }
  };

  const toggleSidebar = () => {
    setSidebarCollapsed((v) => !v);
  };

  const themeMenu = themeOpen ? (
    <div className="theme-dropdown theme-dropdown-sidebar">
      {(["light", "dark", "system"] as ThemeMode[]).map((m) => (
        <div
          key={m}
          className={`theme-dropdown-item ${theme === m ? "active" : ""}`}
          onClick={() => {
            setTheme(m);
            setThemeOpen(false);
          }}
        >
          <span className="theme-dropdown-icon">{React.createElement(THEME_ICON_CMP[m], { size: 16 })}</span>
          <span>{m === "light" ? "浅色" : m === "dark" ? "深色" : "系统"}</span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="app">
      <div className={`titlebar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className="titlebar-sidebar" aria-hidden="true" />
        <div className="titlebar-main" />
        <span className="titlebar-brand">
          <img className="titlebar-icon" src="./icon.png" alt="" draggable={false} />
          <span className="titlebar-brand-text">Codex Bridge</span>
        </span>
      </div>

      <div className={`actionbar ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <div className="actionbar-left">
          <div className="status-badge" onClick={toggleBridge} title="Click to toggle bridge">
            <span className={`status-dot ${bridgeRunning ? "ok" : "err"}`} />
            {bridgeRunning ? "Running" : "Stopped"}
          </div>
        </div>
        <div className="actionbar-right">
          <button
            className={`launch-btn ${codexRunning ? "active" : ""}`}
            onClick={handleLaunchCodex}
          >
            Launch Codex
          </button>
        </div>
      </div>

      <div className={`layout ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>
        <div className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
          <div className="sidebar-nav">
            <div
              className={`sidebar-item ${activeTab === "config" ? "active" : ""}`}
              onClick={() => setActiveTab("config")}
              title="配置"
            >
              <span className="sidebar-item-icon">
                <ConfigIcon size={16} />
              </span>
              <span className="sidebar-item-label">配置</span>
            </div>
            <div
              className={`sidebar-item ${activeTab === "logs" ? "active" : ""}`}
              onClick={() => setActiveTab("logs")}
              title="日志"
            >
              <span className="sidebar-item-icon">
                <LogIcon size={16} />
              </span>
              <span className="sidebar-item-label">日志</span>
            </div>
          </div>
          <div className="sidebar-footer">
            {sidebarCollapsed ? (
              <button
                type="button"
                className="sidebar-footer-btn sidebar-toggle"
                onClick={toggleSidebar}
                title="展开侧边栏"
              >
                <ChevronRightIcon size={16} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="sidebar-footer-btn sidebar-toggle"
                  onClick={toggleSidebar}
                  title="收起侧边栏"
                >
                  <ChevronLeftIcon size={16} />
                </button>
                <div className="theme-menu-wrapper sidebar-theme-menu" ref={themeMenuRef}>
                  <button
                    type="button"
                    className="sidebar-footer-btn theme-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setThemeOpen((v) => !v);
                    }}
                    title="主题"
                  >
                    {React.createElement(THEME_ICON_CMP[theme], { size: 16 })}
                  </button>
                  {themeMenu}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="content">
          {activeTab === "config" ? (
            <>
              <ConfigCard
                config={config}
                onChange={setConfig}
                onSave={handleSave}
                groups={upstreamGroups}
                onGroupsChange={handleGroupsChange}
                activeGroupId={activeGroupId}
                onActiveGroupChange={setActiveGroupId}
                onSelectGroup={handleSelectGroup}
              />
            </>
          ) : (
            <LogPanel logs={logs} onClear={() => setLogs([])} scrollRef={logEndRef} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
