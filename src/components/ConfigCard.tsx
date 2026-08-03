import { ConfigData } from "../App";
import ReasoningModeSelect from "./ReasoningModeSelect";

interface Props {
  config: ConfigData;
  onChange: (c: ConfigData) => void;
  onSave: (c: ConfigData) => void;
}

export default function ConfigCard({ config, onChange, onSave }: Props) {
  const isOpenAI = config.UPSTREAM_FORMAT === "openai";
  const isResponse = config.UPSTREAM_FORMAT === "response";

  const update = (key: keyof ConfigData, value: string) => {
    onChange({ ...config, [key]: value });
  };

  const setFormat = (format: "anthropic" | "openai" | "response") => {
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
    onChange(next);
  };

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
