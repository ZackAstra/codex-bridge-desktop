import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCodexConfig } from "../configStore";

let root: string;
let codexDir: string;
let userDataDir: string;
let configPath: string;
let catalogPath: string;

const FIXTURE = `# user config
model = "gpt-5.5"
model_provider = "bridge"
notify = [
  "node",
  "notify.exe",
]
model_reasoning_effort = "medium"

[model_providers.bridge]
name = "Local Bridge"
base_url = "http://127.0.0.1:8000"
wire_api = "responses"
request_max_retries = 5

[desktop]
localeOverride = "zh-CN"

[projects.'c:\\work']
trust_level = "trusted"

[mcp_servers.foo]
args = [
  "--x",
]
`;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-store-"));
  codexDir = path.join(root, ".codex");
  userDataDir = path.join(root, "userData");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  configPath = path.join(codexDir, "config.toml");
  catalogPath = path.join(codexDir, "models.json");
  fs.writeFileSync(configPath, FIXTURE, "utf-8");
  fs.writeFileSync(
    catalogPath,
    `${JSON.stringify(
      { models: [{ slug: "gpt-5.5", context_window: 400000 }, { slug: "deepseek-v4-flash" }] },
      null,
      2,
    )}\n`,
    "utf-8",
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function payload(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    UPSTREAM_FORMAT: "response",
    RESPONSE_API_KEY: "sk-test",
    RESPONSE_BASE_URL: "https://api.deepseek.com/",
    RESPONSE_MODEL: "deepseek-flash",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
    OPENAI_BASE_URL: "",
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_MODEL: "",
    ANTHROPIC_BASE_URL: "",
    NATIVE_DEEPSEEK_VIA_BRIDGE: "false",
    NATIVE_DEEPSEEK_WEB_SEARCH: "",
    CODEX_MODEL: "",
    CODEX_PROVIDER: "bridge",
    BRIDGE_PORT: "8123",
    CODEX_CONFIG_PATH: codexDir,
    ...overrides,
  };
}

async function apply(
  overrides: Record<string, string> = {},
  options: { confirmRemoveConflicts?: boolean } = {},
) {
  const envWrites: Array<Record<string, string>> = [];
  const logs: string[] = [];
  const result = await writeCodexConfig({
    payload: payload(overrides),
    options,
    userDataDir,
    defaultCodexDir: codexDir,
    effectiveCodexHome: codexDir,
    writeEnv: (value) => envWrites.push(value),
    log: (line) => logs.push(line),
  });
  return { result, envWrites, logs };
}

function statePath(): string {
  return path.join(userDataDir, "native-deepseek-state.json");
}

describe("configStore native deepseek transaction", () => {
  it("applies direct mode, merges the catalog, then restores bridge mode", async () => {
    const direct = await apply();
    expect(direct.result.ok).toBe(true);
    expect(direct.result.mode).toBe("native-deepseek");
    expect(direct.result.backups?.config?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(direct.result.backups?.catalog?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(direct.envWrites).toHaveLength(1);
    expect(fs.existsSync(statePath())).toBe(true);

    const directText = fs.readFileSync(configPath, "utf-8");
    expect(directText).toContain('model = "deepseek-flash"');
    expect(directText).toContain('model_provider = "deepseek"');
    expect(directText).toContain('preferred_auth_method = "apikey"');
    expect(directText).toContain('forced_login_method = "api"');
    expect(directText).toContain('model_reasoning_effort = "high"');
    expect(directText).toContain('web_search = "disabled"');
    expect(directText).toContain("show_raw_agent_reasoning = true");
    expect(directText).toContain('experimental_bearer_token = "sk-test"');
    expect(directText).toContain('model_catalog_json = "');
    expect(directText).toContain(
      'enabled-reasoning-efforts = ["low", "medium", "high", "xhigh", "ultra", "max"]',
    );
    expect(directText).toContain('localeOverride = "zh-CN"');
    expect(directText).toContain('trust_level = "trusted"');
    expect(directText).toContain('"notify.exe"');
    expect(directText).toContain("request_max_retries = 5");

    const directCatalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    const directSlugs = directCatalog.models.map((model: { slug: string }) => model.slug);
    expect(directSlugs).toContain("gpt-5.5");
    expect(directSlugs).toContain("deepseek-flash");
    expect(directSlugs).toContain("deepseek-v4-pro");
    expect(directSlugs).not.toContain("deepseek-v4-flash");

    const bridge = await apply({ NATIVE_DEEPSEEK_VIA_BRIDGE: "true" });
    expect(bridge.result.ok).toBe(true);
    expect(bridge.result.mode).toBe("bridge");
    expect(fs.existsSync(statePath())).toBe(false);

    const bridgeText = fs.readFileSync(configPath, "utf-8");
    expect(bridgeText).toContain('model_provider = "bridge"');
    expect(bridgeText).toContain('base_url = "http://127.0.0.1:8123"');
    expect(bridgeText).toContain("stream_idle_timeout_ms = 300000");
    expect(bridgeText).not.toContain("preferred_auth_method");
    expect(bridgeText).not.toContain("forced_login_method");
    expect(bridgeText).not.toContain("experimental_bearer_token");
    expect(bridgeText).toContain('model_catalog_json = "');
    expect(bridgeText).not.toContain("enabled-reasoning-efforts");
    expect(bridgeText).toContain('model_reasoning_effort = "medium"');
    expect(bridgeText).toContain('localeOverride = "zh-CN"');
    expect(bridgeText).toContain('trust_level = "trusted"');
    expect(bridgeText).toContain("request_max_retries = 5");

    const bridgeCatalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
    expect(bridgeCatalog.models.map((model: { slug: string }) => model.slug)).toContain(
      "deepseek-v4-pro",
    );
  });

  it("requires confirmation before removing conflicts and restores them later", async () => {
    fs.writeFileSync(
      configPath,
      FIXTURE.replace(
        'model_provider = "bridge"',
        'model_provider = "bridge"\nmodel_context_window = 200000',
      ),
      "utf-8",
    );
    const beforeText = fs.readFileSync(configPath, "utf-8");

    const blocked = await apply();
    expect(blocked.result.ok).toBe(false);
    expect(blocked.result.code).toBe("conflicts");
    expect(
      blocked.result.conflicts?.some((conflict) => conflict.key === "model_context_window"),
    ).toBe(true);
    expect(blocked.envWrites).toHaveLength(0);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(beforeText);
    expect(fs.existsSync(statePath())).toBe(false);

    const direct = await apply({}, { confirmRemoveConflicts: true });
    expect(direct.result.ok).toBe(true);
    expect(fs.readFileSync(configPath, "utf-8")).not.toContain("model_context_window");

    const bridge = await apply({ NATIVE_DEEPSEEK_VIA_BRIDGE: "true" });
    expect(bridge.result.ok).toBe(true);
    expect(fs.readFileSync(configPath, "utf-8")).toContain("model_context_window = 200000");
  });
});
