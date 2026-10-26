import { useState } from "react";
import {
  ConfigData,
  DEEPSEEK_WEB_SEARCH_MODEL,
  UpstreamGroup,
  UpstreamGroupMap,
  canonicalDeepseekModel,
  createGroup,
  findGroup,
  isGroupDirty,
  isNativeDeepseekUrl,
  matchAppliedGroup,
  nextGroupName,
  removeGroup,
  renameGroup,
} from "../config";
import ReasoningModeSelect from "./ReasoningModeSelect";

interface Props {
  config: ConfigData;
  onChange: (c: ConfigData) => void;
  onSave: (c: ConfigData) => Promise<boolean>;
  groups: UpstreamGroupMap;
  onGroupsChange: (next: UpstreamGroupMap) => Promise<boolean>;
  activeGroupId: string | null;
  onActiveGroupChange: (id: string | null) => void;
  onSelectGroup: (format: ConfigData["UPSTREAM_FORMAT"], group: UpstreamGroup) => void;
}

export default function ConfigCard({
  config,
  onChange,
  onSave,
  groups,
  onGroupsChange,
  activeGroupId,
  onActiveGroupChange,
  onSelectGroup,
}: Props) {
  const isOpenAI = config.UPSTREAM_FORMAT === "openai";
  const isResponse = config.UPSTREAM_FORMAT === "response";
  const format = config.UPSTREAM_FORMAT;
  const groupList = groups[format] || [];
  const activeGroup = findGroup(groups, format, activeGroupId);
  const dirty = isGroupDirty(config, activeGroup, format);
  const nativeResponse = isResponse && isNativeDeepseekUrl(config.RESPONSE_BASE_URL, "responses");
  const nativeOpenAI = isOpenAI && isNativeDeepseekUrl(config.OPENAI_BASE_URL, "chat");
  const nativeAnthropic =
    !isOpenAI && !isResponse && isNativeDeepseekUrl(config.ANTHROPIC_BASE_URL, "anthropic");
  const directMode = nativeResponse && config.NATIVE_DEEPSEEK_VIA_BRIDGE !== "true";
  const canonicalResponseModel = canonicalDeepseekModel(config.RESPONSE_MODEL);
  const showWebSearch = directMode && canonicalResponseModel === DEEPSEEK_WEB_SEARCH_MODEL;
  const activeModel = isResponse
    ? config.RESPONSE_MODEL
    : isOpenAI
      ? config.OPENAI_MODEL
      : config.ANTHROPIC_MODEL;
  const nonNativeDeepseek =
    !nativeResponse &&
    !nativeOpenAI &&
    !nativeAnthropic &&
    activeModel.toLowerCase().includes("deepseek");

  const [editMode, setEditMode] = useState<null | "add" | "rename">(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (key: keyof ConfigData, value: string) => {
    onChange({ ...config, [key]: value });
  };

  const clearEdit = () => {
    setEditMode(null);
    setEditId(null);
    setDraftName("");
  };

  const confirmDiscard = (): boolean => {
    if (!dirty) return true;
    return window.confirm("当前分组有未保存的修改，切换后将丢弃。继续？");
  };

  const setFormat = (nextFormat: ConfigData["UPSTREAM_FORMAT"]) => {
    if (nextFormat === format) return;
    if (!confirmDiscard()) return;
    clearEdit();
    const next: ConfigData = { ...config, UPSTREAM_FORMAT: nextFormat };
    if (nextFormat === "openai" && !next.OPENAI_BASE_URL) {
      next.OPENAI_BASE_URL = "https://api.deepseek.com/v1";
    }
    if (nextFormat === "anthropic" && !next.ANTHROPIC_BASE_URL) {
      next.ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic";
    }
    if (nextFormat === "response" && !next.RESPONSE_BASE_URL) {
      next.RESPONSE_BASE_URL = "https://api.openai.com/v1";
    }
    onChange(next);
    onActiveGroupChange(matchAppliedGroup(groups, nextFormat, next)?.id ?? null);
  };

  const selectGroup = (g: UpstreamGroup) => {
    if (!confirmDiscard()) return;
    clearEdit();
    onSelectGroup(format, g);
  };

  const handleAdd = () => {
    setEditMode("add");
    setEditId(null);
    setDraftName(nextGroupName(groupList));
  };

  const handleDoubleClick = (g: UpstreamGroup) => {
    if (editMode === "add") return;
    setEditMode("rename");
    setEditId(g.id);
    setDraftName(g.name);
  };

  const handleDone = async (): Promise<boolean> => {
    const name = draftName.trim();
    if (editMode === "add") {
      const { groups: next, group: created } = createGroup(groups, format, name, config, Date.now());
      if (!(await onGroupsChange(next))) return false;
      onActiveGroupChange(created.id);
      clearEdit();
      return true;
    }
    if (editMode === "rename") {
      if (editId) {
        const next = renameGroup(groups, format, editId, name);
        if (next !== groups && !(await onGroupsChange(next))) return false;
      }
      clearEdit();
      return true;
    }
    return true;
  };

  const handleDelete = async () => {
    if (!activeGroup) return;
    if (!window.confirm(`删除分组「${activeGroup.name}」？此操作不可撤销。`)) return;
    const next = removeGroup(groups, format, activeGroup.id);
    if (!(await onGroupsChange(next))) return;
    onActiveGroupChange(null);
    clearEdit();
  };

  const handleSaveClick = async () => {
    setSaving(true);
    try {
      if (editMode && !(await handleDone())) return;
      await onSave(config);
    } finally {
      setSaving(false);
    }
  };

  const renderEditInput = (key: string) => (
    <span key={key} className="group-name-input-wrap">
      <input
        className="group-name-input"
        value={draftName}
        autoFocus
        aria-label="分组名称"
        onChange={(e) => setDraftName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleDone();
          if (e.key === "Escape") clearEdit();
        }}
      />
      <span className="group-edit-actions">
        <button
          type="button"
          className="group-edit-btn confirm"
          onClick={() => void handleDone()}
          title="确认分组名（Enter）"
        >
          ✓
        </button>
        <button
          type="button"
          className="group-edit-btn cancel"
          onClick={clearEdit}
          title="取消（Esc）"
        >
          ×
        </button>
      </span>
    </span>
  );

  const groupBar = (
    <>
      <div className="seg-control group-seg">
        {activeGroupId === null && <span className="group-empty-hint">未分组</span>}
        {groupList.map((g) =>
          editMode === "rename" && editId === g.id ? (
            renderEditInput(g.id)
          ) : (
            <button
              key={g.id}
              type="button"
              className={`seg-btn group-name-btn ${activeGroupId === g.id ? "active" : ""}`}
              onClick={() => selectGroup(g)}
              onDoubleClick={() => handleDoubleClick(g)}
              title="单击切换，双击重命名"
            >
              {g.name}
            </button>
          ),
        )}
        <button
          type="button"
          className={`seg-btn group-add-btn ${editMode === "add" ? "active" : ""}`}
          onClick={handleAdd}
          title="以当前表单值新增分组"
        >
          +
        </button>
        {editMode === "add" && renderEditInput("new-group")}
      </div>
      {activeGroup && (
        <button
          type="button"
          className="group-delete-btn"
          onClick={() => void handleDelete()}
          title="删除当前分组"
        >
          删除
        </button>
      )}
    </>
  );

  return (
    <div className="card">
      <div className="card-title">Upstream Format</div>
      <div className="field">
        <label>Format</label>
        <div className="seg-control">
          <button
            className={`seg-btn ${config.UPSTREAM_FORMAT === "anthropic" ? "active" : ""}`}
            onClick={() => setFormat("anthropic")}
          >
            Anthropic
          </button>
          <button
            className={`seg-btn ${config.UPSTREAM_FORMAT === "openai" ? "active" : ""}`}
            onClick={() => setFormat("openai")}
          >
            OpenAI
          </button>
          <button
            className={`seg-btn ${config.UPSTREAM_FORMAT === "response" ? "active" : ""}`}
            onClick={() => setFormat("response")}
          >
            Responses
          </button>
        </div>
      </div>

      {/* Anthropic tab */}
      {!isOpenAI && !isResponse && (
        <>
          <div className="card-title" style={{ marginTop: 12 }}>
            Anthropic Upstream
          </div>
          <div className="field">
            <label>Label</label>
            {groupBar}
          </div>
          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              placeholder="sk-..."
              value={config.ANTHROPIC_AUTH_TOKEN}
              onChange={(e) => update("ANTHROPIC_AUTH_TOKEN", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Model Name</label>
            <input
              type="text"
              placeholder="MiniMax-M2.7"
              value={config.ANTHROPIC_MODEL}
              onChange={(e) => update("ANTHROPIC_MODEL", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Anthropic Base URL</label>
            <input
              type="text"
              placeholder="https://api.minimaxi.com/anthropic"
              value={config.ANTHROPIC_BASE_URL}
              onChange={(e) => update("ANTHROPIC_BASE_URL", e.target.value)}
            />
          </div>
        </>
      )}

      {/* OpenAI tab */}
      {isOpenAI && !isResponse && (
        <>
          <div className="card-title" style={{ marginTop: 12 }}>
            OpenAI Upstream
          </div>
          <div className="field">
            <label>Label</label>
            {groupBar}
          </div>
          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              placeholder="sk-..."
              value={config.OPENAI_API_KEY}
              onChange={(e) => update("OPENAI_API_KEY", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Model Name</label>
            <input
              type="text"
              placeholder="deepseek-flash"
              value={config.OPENAI_MODEL}
              onChange={(e) => update("OPENAI_MODEL", e.target.value)}
            />
          </div>
          <div className="field">
            <label>OpenAI Base URL</label>
            <input
              type="text"
              placeholder="https://api.deepseek.com/v1"
              value={config.OPENAI_BASE_URL}
              onChange={(e) => update("OPENAI_BASE_URL", e.target.value)}
            />
          </div>
        </>
      )}

      {/* Responses tab */}
      {isResponse && (
        <>
          <div className="card-title" style={{ marginTop: 12 }}>
            Responses Upstream
          </div>
          <div className="field">
            <label>Label</label>
            {groupBar}
          </div>
          <div className="field">
            <label>API Key</label>
            <input
              type="password"
              placeholder="sk-..."
              value={config.RESPONSE_API_KEY}
              onChange={(e) => update("RESPONSE_API_KEY", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Model Name</label>
            <input
              type="text"
              placeholder="deepseek-flash"
              value={config.RESPONSE_MODEL}
              onChange={(e) => update("RESPONSE_MODEL", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Responses Base URL</label>
            <input
              type="text"
              placeholder="https://api.deepseek.com/"
              value={config.RESPONSE_BASE_URL}
              onChange={(e) => update("RESPONSE_BASE_URL", e.target.value)}
            />
          </div>
        </>
      )}

      {nativeResponse && (
        <div className="native-deepseek-hint">
          <div className="native-deepseek-hint-title">
            {directMode ? "原生 DeepSeek · 官方直连" : "原生 DeepSeek · 经 Bridge"}
          </div>
          <div className="native-deepseek-hint-body">
            {directMode
              ? "Codex 将直连 https://api.deepseek.com/，读取 models.json，并锁定 deepseek-flash / deepseek-v4-pro。"
              : "Codex 仍连接本地 Bridge，由 Bridge 转发到 DeepSeek Responses API。"}
          </div>
          <label className="native-deepseek-check">
            <input
              type="checkbox"
              checked={config.NATIVE_DEEPSEEK_VIA_BRIDGE === "true"}
              onChange={(e) =>
                update("NATIVE_DEEPSEEK_VIA_BRIDGE", e.target.checked ? "true" : "false")
              }
            />
            经 Bridge 转发（保留日志）
          </label>
          {showWebSearch && (
            <label className="native-deepseek-check">
              <input
                type="checkbox"
                checked={config.NATIVE_DEEPSEEK_WEB_SEARCH === "live"}
                onChange={(e) =>
                  update("NATIVE_DEEPSEEK_WEB_SEARCH", e.target.checked ? "live" : "")
                }
              />
              启用联网搜索（仅 deepseek-v4-pro，按次计费）
            </label>
          )}
        </div>
      )}

      {nativeOpenAI && (
        <div className="native-deepseek-hint">
          <div className="native-deepseek-hint-title">原生 DeepSeek · 协议转换</div>
          <div className="native-deepseek-hint-body">
            Codex 只支持 Responses API，Chat 上游仍需经 Bridge 转换；推理强度按官方
            low/high/max 三档映射。
          </div>
        </div>
      )}

      {nativeAnthropic && (
        <div className="native-deepseek-hint">
          <div className="native-deepseek-hint-title">原生 DeepSeek · 协议转换</div>
          <div className="native-deepseek-hint-body">
            Codex 只支持 Responses API，Anthropic 上游仍需经 Bridge 转换；强度写入
            output_config.effort。
          </div>
        </div>
      )}

      {nonNativeDeepseek && (
        <div className="native-deepseek-hint">
          <div className="native-deepseek-hint-title">非原生 DeepSeek 域名</div>
          <div className="native-deepseek-hint-body">
            {isResponse
              ? "当前为 Responses 上游，effort 会原样透传；自动模式不会套用 DeepSeek 官方规则。若中转站只支持低/高/最高，请在该上游侧选择对应档位，或改用 Chat/Anthropic 格式。"
              : "自动推理模式不会套用 DeepSeek 官方规则；如需注入 thinking/effort，可在下方 Reasoning Mode 手动选择 DeepSeek。"}
          </div>
        </div>
      )}

      {!isResponse && (
        <ReasoningModeSelect
          value={config.CODEX_CHAT_REASONING_MODE || "auto"}
          onChange={(v) => update("CODEX_CHAT_REASONING_MODE", v)}
          upstreamFormat={config.UPSTREAM_FORMAT === "anthropic" ? "anthropic" : "openai"}
        />
      )}

      <div className="card-title" style={{ marginTop: 12 }}>
        Codex Integration
      </div>
      <div className="field">
        <label>Default Model</label>
        <input
          type="text"
          placeholder="match model name above"
          value={directMode ? canonicalResponseModel || config.RESPONSE_MODEL : config.CODEX_MODEL}
          disabled={directMode}
          title={directMode ? "官方直连模式使用上游模型" : undefined}
          onChange={(e) => update("CODEX_MODEL", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Provider</label>
        <input
          type="text"
          placeholder="bridge"
          value={directMode ? "deepseek" : config.CODEX_PROVIDER}
          disabled={directMode}
          title={directMode ? "官方直连模式固定使用 deepseek provider" : undefined}
          onChange={(e) => update("CODEX_PROVIDER", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Bridge Port</label>
        <input
          type="text"
          placeholder="8000"
          value={config.BRIDGE_PORT}
          disabled={directMode}
          title={directMode ? "官方直连模式不使用 Bridge" : undefined}
          onChange={(e) => update("BRIDGE_PORT", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Codex Config Path</label>
        <input
          type="text"
          placeholder="C:\Users\xxx\.codex"
          value={config.CODEX_CONFIG_PATH}
          onChange={(e) => update("CODEX_CONFIG_PATH", e.target.value)}
        />
      </div>

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={() => void handleSaveClick()}
          disabled={saving}
          title="保存当前分组的值，并写入 .env / config.toml"
        >
          {saving ? "Saving..." : "Save Config"}
          {dirty && <span className="group-dirty-dot" title="当前分组有未保存的修改" />}
        </button>
        <span className="save-hint">保存分组值并应用到 .env / config.toml</span>
      </div>
    </div>
  );
}
