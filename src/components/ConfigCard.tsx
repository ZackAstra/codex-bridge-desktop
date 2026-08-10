import { useState } from "react";
import { ConfigData, UpstreamGroup, UpstreamGroupMap, FORMAT_KEYS } from "../App";
import ReasoningModeSelect from "./ReasoningModeSelect";

interface Props {
  config: ConfigData;
  onChange: (c: ConfigData) => void;
  onSave: (c: ConfigData) => void;
  groups: UpstreamGroupMap;
  onGroupsChange: (next: UpstreamGroupMap) => void;
  activeGroupId: string | null;
  onActiveGroupChange: (id: string | null) => void;
  onSelectGroup: (format: ConfigData["UPSTREAM_FORMAT"], group: UpstreamGroup) => void;
}

function genGroupId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextGroupName(list: UpstreamGroup[]): string {
  const used = new Set(list.map((g) => g.name));
  let n = 1;
  while (used.has(`新分组${n}`)) n += 1;
  return `新分组${n}`;
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

  const [editMode, setEditMode] = useState<null | "add" | "rename">(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const update = (key: keyof ConfigData, value: string) => {
    onChange({ ...config, [key]: value });
  };

  const clearEdit = () => {
    setEditMode(null);
    setEditId(null);
    setDraftName("");
  };

  const setFormat = (format: "anthropic" | "openai" | "response") => {
    clearEdit();
    const next: ConfigData = { ...config, UPSTREAM_FORMAT: format };
    if (format === "openai" && !next.OPENAI_BASE_URL) {
      next.OPENAI_BASE_URL = "https://api.deepseek.com/v1";
    }
    if (format === "anthropic" && !next.ANTHROPIC_BASE_URL) {
      next.ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic";
    }
    if (format === "response" && !next.RESPONSE_BASE_URL) {
      next.RESPONSE_BASE_URL = "https://api.openai.com/v1";
    }
    const list = groups[format] || [];
    if (list.length > 0) {
      const recent = [...list].sort((a, b) => b.selectedAt - a.selectedAt)[0];
      const keys = FORMAT_KEYS[format];
      next[keys.apiKey] = recent.apiKey;
      next[keys.model] = recent.model;
      next[keys.baseUrl] = recent.baseUrl;
      onActiveGroupChange(recent.id);
    } else {
      onActiveGroupChange(null);
    }
    onChange(next);
  };

  const selectGroup = (g: UpstreamGroup) => {
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

  const handleDone = () => {
    const name = draftName.trim();
    if (editMode === "add") {
      const keys = FORMAT_KEYS[format];
      const newGroup: UpstreamGroup = {
        id: genGroupId(),
        name: name || nextGroupName(groupList),
        apiKey: config[keys.apiKey] || "",
        model: config[keys.model] || "",
        baseUrl: config[keys.baseUrl] || "",
        selectedAt: Date.now(),
      };
      const next = { ...groups, [format]: [...groupList, newGroup] };
      onGroupsChange(next);
      onActiveGroupChange(newGroup.id);
      clearEdit();
    } else if (editMode === "rename" && editId) {
      const target = groupList.find((g) => g.id === editId);
      if (target) {
        const next = {
          ...groups,
          [format]: groupList.map((g) => (g.id === editId ? { ...g, name: name || target.name } : g)),
        };
        onGroupsChange(next);
      }
      clearEdit();
    }
  };

  const editInput = (
    <input
      className="group-name-input"
      value={draftName}
      autoFocus
      onChange={(e) => setDraftName(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleDone();
        if (e.key === "Escape") clearEdit();
      }}
    />
  );

  const groupBar = (
    <>
      <div className="seg-control group-seg">
        {groupList.length === 0 ? (
          editMode === "add" ? (
            <span className="group-name-input-wrap">{editInput}</span>
          ) : (
            <span className={`seg-btn group-name-btn ${activeGroupId === null ? "active" : ""}`}>
              新分组1
            </span>
          )
        ) : (
          groupList.map((g) =>
            editMode === "rename" && editId === g.id ? (
              <span key={g.id} className="group-name-input-wrap">
                {editInput}
              </span>
            ) : (
              <button
                key={g.id}
                className={`seg-btn group-name-btn ${activeGroupId === g.id ? "active" : ""}`}
                onClick={() => selectGroup(g)}
                onDoubleClick={() => handleDoubleClick(g)}
                title="双击重命名"
              >
                {g.name}
              </button>
            ),
          )
        )}
        <button
          className={`seg-btn group-add-btn ${editMode === "add" ? "active" : ""}`}
          onClick={handleAdd}
          title="新增分组"
        >
          +
        </button>
        {editMode === "add" && groupList.length > 0 && (
          <span className="group-name-input-wrap">{editInput}</span>
        )}
      </div>
      {(editMode === "add" || editMode === "rename") && (
        <button className="group-done-btn" onClick={handleDone} title="完成保存">
          ✓
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
              placeholder="deepseek-v4-flash"
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
              placeholder="gpt-5"
              value={config.RESPONSE_MODEL}
              onChange={(e) => update("RESPONSE_MODEL", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Responses Base URL</label>
            <input
              type="text"
              placeholder="https://api.openai.com/v1"
              value={config.RESPONSE_BASE_URL}
              onChange={(e) => update("RESPONSE_BASE_URL", e.target.value)}
            />
          </div>
        </>
      )}

      <ReasoningModeSelect
        value={config.CODEX_CHAT_REASONING_MODE || "auto"}
        onChange={(v) => update("CODEX_CHAT_REASONING_MODE", v)}
        upstreamFormat={config.UPSTREAM_FORMAT === "response" ? "openai" : config.UPSTREAM_FORMAT}
      />

      <div className="card-title" style={{ marginTop: 12 }}>
        Codex Integration
      </div>
      <div className="field">
        <label>Default Model</label>
        <input
          type="text"
          placeholder="match model name above"
          value={config.CODEX_MODEL}
          onChange={(e) => update("CODEX_MODEL", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Provider</label>
        <input
          type="text"
          placeholder="bridge"
          value={config.CODEX_PROVIDER}
          onChange={(e) => update("CODEX_PROVIDER", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Bridge Port</label>
        <input
          type="text"
          placeholder="8000"
          value={config.BRIDGE_PORT}
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
        <button className="btn btn-primary" onClick={() => onSave(config)}>
          Save Config
        </button>
      </div>
    </div>
  );
}
