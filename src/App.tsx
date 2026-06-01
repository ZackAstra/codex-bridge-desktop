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
  CODEX_CHAT_REASONING_MODE: string;
  CODEX_MODEL: string;
  CODEX_PROVIDER: string;
  BRIDGE_PORT: string;
  CODEX_CONFIG_PATH: string;
  UPSTREAM_FORMAT: "anthropic" | "openai";
}

export interface LogLine {
  text: string;
  level: "info" | "success" | "error" | "warn";
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
    CODEX_CHAT_REASONING_MODE: "auto",
    CODEX_MODEL: "",
    CODEX_PROVIDER: "bridge",
    BRIDGE_PORT: "8000",
    CODEX_CONFIG_PATH: "",
    UPSTREAM_FORMAT: "anthropic",
  });
  const [logs, setLogs] = useState<LogLine[]>([]);
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
    window.electronAPI.readConfig().then((cfg: Record<string, string>) => {
      setConfig((prev) => ({
        ...prev,
        ...cfg,
        UPSTREAM_FORMAT: (cfg.UPSTREAM_FORMAT as ConfigData["UPSTREAM_FORMAT"]) || prev.UPSTREAM_FORMAT,
        CODEX_CHAT_REASONING_MODE: cfg.CODEX_CHAT_REASONING_MODE || prev.CODEX_CHAT_REASONING_MODE,
      }));
      addLog("Loaded existing config", "info");
    });

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

    window.electronAPI.onCodexStatus((status: { running: boolean }) => {
      setCodexRunning(status.running);
    });

    return () => {
      window.electronAPI.offLog();
      window.electronAPI.offBridgeStatus();
      window.electronAPI.offCodexStatus();
    };
  }, []);

  const addLog = useCallback((text: string, level: LogLine["level"] = "info") => {
    setLogs((prev) => [...prev, { text: `[${new Date().toLocaleTimeString()}] ${text}`, level }]);
  }, []);

  const handleSave = async (data: ConfigData) => {
    setConfig(data);
    const result = await window.electronAPI.writeConfig(data as unknown as Record<string, string>);
    if (result.ok) addLog("Configuration saved", "success");
    else addLog(`Save failed: ${result.error}`, "error");
  };

  const handleStartBridge = async () => {
    const result = await window.electronAPI.startBridge();
    if (result.ok) {
      setBridgeRunning(true);
      addLog("Bridge server started on port " + config.BRIDGE_PORT, "success");
    } else {
      addLog(`Start failed: ${result.error}`, "error");
    }
  };

  const handleStopBridge = async () => {
    const result = await window.electronAPI.stopBridge();
    if (result.ok) {
      setBridgeRunning(false);
      addLog("Bridge server stopped", "info");
    } else {
      addLog(`Stop failed: ${result.error}`, "error");
    }
  };

  const toggleBridge = () => {
    if (bridgeRunning) handleStopBridge();
    else handleStartBridge();
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
              <ConfigCard config={config} onChange={setConfig} onSave={handleSave} />
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
