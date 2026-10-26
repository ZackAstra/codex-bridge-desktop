import React, { useEffect, useRef, useState, useCallback } from "react";
import ConfigCard from "./components/ConfigCard";
import LogPanel from "./components/LogPanel";
import {
  ConfigData,
  EMPTY_GROUPS,
  FORMAT_KEYS,
  UpstreamGroup,
  UpstreamGroupMap,
  findGroup,
  isNativeDeepseekUrl,
  matchAppliedGroup,
  normalizeGroups,
  upsertGroupValues,
} from "./config";
import {
  SunIcon,
  MoonIcon,
  MonitorIcon,
  ConfigIcon,
  LogIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "./components/Icons";

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
    NATIVE_DEEPSEEK_VIA_BRIDGE: "false",
    NATIVE_DEEPSEEK_WEB_SEARCH: "",
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
  const groupsRef = useRef<UpstreamGroupMap>(EMPTY_GROUPS);
  const activeGroupIdRef = useRef<string | null>(null);

  const selectActiveGroup = useCallback((id: string | null) => {
    activeGroupIdRef.current = id;
    setActiveGroupId(id);
  }, []);

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
        const rawFormat = cfg.UPSTREAM_FORMAT;
        const format: ConfigData["UPSTREAM_FORMAT"] =
          rawFormat === "openai" || rawFormat === "response" ? rawFormat : "anthropic";
        const applied = { ...cfg, UPSTREAM_FORMAT: format } as unknown as ConfigData;
        setConfig((prev) => ({
          ...prev,
          ...cfg,
          UPSTREAM_FORMAT: format,
          CODEX_CHAT_REASONING_MODE: cfg.CODEX_CHAT_REASONING_MODE || prev.CODEX_CHAT_REASONING_MODE,
        }));
        groupsRef.current = groups;
        setUpstreamGroups(groups);
        selectActiveGroup(matchAppliedGroup(groups, format, applied)?.id ?? null);
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

  const persistGroups = useCallback(
    async (next: UpstreamGroupMap): Promise<boolean> => {
      const prev = groupsRef.current;
      groupsRef.current = next;
      setUpstreamGroups(next);
      const result = await window.electronAPI.writeUpstreamGroups(
        next as unknown as Record<string, unknown>,
      );
      if (!result.ok) {
        if (groupsRef.current === next) {
          groupsRef.current = prev;
          setUpstreamGroups(prev);
        }
        addLog(`Save groups failed: ${result.error}`, "error");
        return false;
      }
      return true;
    },
    [addLog],
  );

  const commitConfig = useCallback(
    async (cfg: ConfigData, options?: WriteConfigOptions): Promise<boolean> => {
      const format = cfg.UPSTREAM_FORMAT;
      const group = findGroup(groupsRef.current, format, activeGroupIdRef.current);
      const write = (opts?: WriteConfigOptions) =>
        window.electronAPI.writeConfig(cfg as unknown as Record<string, string>, opts);

      let result: WriteConfigResult;
      try {
        result = await write(options);
        if (!result.ok && result.code === "conflicts" && !options?.confirmRemoveConflicts) {
          const lines = (result.conflicts || [])
            .map((item) => `- ${item.key}: ${item.reason}`)
            .join("\n");
          const confirmed = window.confirm(
            `检测到会覆盖 DeepSeek 官方配置的键：\n\n${lines}\n\n确认移除并继续？`,
          );
          if (!confirmed) {
            addLog("Save cancelled: conflicts were not confirmed", "warn");
            return false;
          }
          result = await write({ confirmRemoveConflicts: true });
        }
      } catch (error) {
        addLog(`Save failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        return false;
      }

      if (!result.ok) return false;

      if (result.mode === "native-deepseek" && bridgeRunning) {
        addLog("Bridge 正在运行，但官方直连模式不会使用它；可手动停止", "warn");
      }
      if (result.mode === "bridge" && bridgeRunning) {
        addLog("Bridge is running with the previous config; restart it to apply", "warn");
      }
      if (group) {
        const next = upsertGroupValues(groupsRef.current, format, group.id, cfg, Date.now());
        if (!(await persistGroups(next))) {
          addLog("Config applied, but saving the group failed", "warn");
        }
      }
      addLog(group ? `Config saved (group: ${group.name})` : "Config saved (no group)", "success");
      return true;
    },
    [addLog, bridgeRunning, persistGroups],
  );

  const handleSelectGroup = (format: ConfigData["UPSTREAM_FORMAT"], group: UpstreamGroup) => {
    selectActiveGroup(group.id);
    const keys = FORMAT_KEYS[format];
    setConfig((prev) => ({
      ...prev,
      [keys.apiKey]: group.apiKey,
      [keys.model]: group.model,
      [keys.baseUrl]: group.baseUrl,
    }));
  };

  const nativeDirect =
    config.UPSTREAM_FORMAT === "response" &&
    isNativeDeepseekUrl(config.RESPONSE_BASE_URL, "responses") &&
    config.NATIVE_DEEPSEEK_VIA_BRIDGE !== "true";

  const toggleBridge = async () => {
    if (nativeDirect) return;
    if (bridgeRunning) {
      await window.electronAPI.stopBridge();
      return;
    }
    if (!(await commitConfig(config))) return;
    const result = await window.electronAPI.startBridge();
    if (!result.ok) addLog(result.error || "Bridge start failed", "warn");
  };

  const handleLaunchCodex = async () => {
    if (!(await commitConfig(config))) return;
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
          <div
            className={`status-badge ${nativeDirect ? "disabled" : ""}`}
            onClick={nativeDirect ? undefined : toggleBridge}
            title={nativeDirect ? "官方直连模式不经过 Bridge" : "Click to toggle bridge"}
          >
            <span className={`status-dot ${nativeDirect || bridgeRunning ? "ok" : "err"}`} />
            {nativeDirect ? "Direct" : bridgeRunning ? "Running" : "Stopped"}
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
                onSave={commitConfig}
                groups={upstreamGroups}
                onGroupsChange={persistGroups}
                activeGroupId={activeGroupId}
                onActiveGroupChange={selectActiveGroup}
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
