import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildCodexConfigPlan, PlanOptions } from "../configPlan";

const codexDir = path.join(os.tmpdir(), "codex-plan-test");

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
    BRIDGE_PORT: "8000",
    CODEX_CONFIG_PATH: codexDir,
    ...overrides,
  };
}

function options(overrides: Partial<PlanOptions> = {}): PlanOptions {
  return {
    codexDir,
    effectiveCodexHome: codexDir,
    existingText: "",
    existingCatalogPath: null,
    confirmRemoveConflicts: false,
    ...overrides,
  };
}

function planOf(p: Record<string, string>, o: PlanOptions = options()) {
  const result = buildCodexConfigPlan(p, o);
  if (result.ok !== true) throw new Error(result.error);
  return result.plan;
}

function topLevelMap(plan: ReturnType<typeof planOf>): Record<string, string> {
  return Object.fromEntries(plan.topLevel.map((entry) => [entry.key, entry.raw]));
}

describe("configPlan", () => {
  it("builds the official direct plan for a native responses upstream", () => {
    const plan = planOf(payload());
    expect(plan.mode).toBe("native-deepseek");
    expect(plan.model).toBe("deepseek-flash");
    expect(plan.provider).toBe("deepseek");
    expect(plan.catalogTarget?.endsWith("models.json")).toBe(true);
    expect(plan.desktopEfforts).toEqual(["low", "medium", "high", "xhigh", "ultra", "max"]);
    expect(plan.providerSection?.section).toBe("model_providers.deepseek");
    expect(plan.providerSection?.replace).toBe(true);

    const top = topLevelMap(plan);
    expect(top.model).toBe('"deepseek-flash"');
    expect(top.model_provider).toBe('"deepseek"');
    expect(top.preferred_auth_method).toBe('"apikey"');
    expect(top.forced_login_method).toBe('"api"');
    expect(top.model_reasoning_effort).toBe('"high"');
    expect(top.web_search).toBe('"disabled"');
    expect(top.show_raw_agent_reasoning).toBe("true");
    expect(top.model_catalog_json).toContain("models.json");

    const section = Object.fromEntries(plan.providerSection!.values.map((entry) => [entry.key, entry.raw]));
    expect(section.base_url).toBe('"https://api.deepseek.com/"');
    expect(section.wire_api).toBe('"responses"');
    expect(section.experimental_bearer_token).toBe('"sk-test"');
    expect(plan.conflicts).toEqual([]);
  });

  it("maps legacy models and enables web search only for v4-pro", () => {
    const legacy = planOf(payload({ RESPONSE_MODEL: "deepseek-v4-flash" }));
    expect(legacy.model).toBe("deepseek-flash");
    expect(legacy.warnings.some((warning) => warning.includes("已映射"))).toBe(true);

    const pro = planOf(
      payload({ RESPONSE_MODEL: "deepseek-v4-pro", NATIVE_DEEPSEEK_WEB_SEARCH: "live" }),
    );
    expect(topLevelMap(pro).web_search).toBe('"live"');

    const flash = planOf(
      payload({ RESPONSE_MODEL: "deepseek-flash", NATIVE_DEEPSEEK_WEB_SEARCH: "live" }),
    );
    expect(topLevelMap(flash).web_search).toBe('"disabled"');
  });

  it("rejects unknown models, missing keys and path mismatches", () => {
    const invalid = buildCodexConfigPlan(payload({ RESPONSE_MODEL: "deepseek-chat" }), options());
    expect(invalid.ok).toBe(false);
    if (invalid.ok !== true) expect(invalid.code).toBe("invalid_model");

    const missing = buildCodexConfigPlan(payload({ RESPONSE_API_KEY: "" }), options());
    expect(missing.ok).toBe(false);
    if (missing.ok !== true) expect(missing.code).toBe("missing_key");

    const mismatch = buildCodexConfigPlan(
      payload(),
      options({ effectiveCodexHome: path.join(os.tmpdir(), "other-codex-home") }),
    );
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok !== true) expect(mismatch.code).toBe("path_mismatch");
  });

  it("requires confirmation for conflicting keys", () => {
    const existingText = 'model = "gpt-5.5"\nmodel_context_window = 200000\n';
    const blocked = buildCodexConfigPlan(payload(), options({ existingText }));
    expect(blocked.ok).toBe(false);
    if (blocked.ok !== true) {
      expect(blocked.code).toBe("conflicts");
      expect(blocked.conflicts?.some((conflict) => conflict.key === "model_context_window")).toBe(
        true,
      );
    }

    const confirmed = planOf(payload(), options({ existingText, confirmRemoveConflicts: true }));
    expect(confirmed.topLevelRemove).toContain("model_context_window");
  });

  it("keeps an existing catalog path", () => {
    const custom = path.join(codexDir, "custom-models.json");
    const plan = planOf(payload(), options({ existingCatalogPath: custom }));
    expect(plan.catalogTarget).toBe(custom.replace(/\\/g, "/"));
  });

  it("builds a bridge plan with a fixed idle timeout", () => {
    const plan = planOf(
      payload({ NATIVE_DEEPSEEK_VIA_BRIDGE: "true", BRIDGE_PORT: "8123" }),
    );
    expect(plan.mode).toBe("bridge");
    expect(plan.provider).toBe("bridge");
    expect(plan.catalogTarget).toBeNull();
    expect(plan.providerSection?.replace).toBe(false);
    const section = Object.fromEntries(plan.providerSection!.values.map((entry) => [entry.key, entry.raw]));
    expect(section.base_url).toBe('"http://127.0.0.1:8123"');
    expect(section.stream_idle_timeout_ms).toBe("300000");
    expect(plan.warnings.some((warning) => warning.includes("经 Bridge"))).toBe(true);
  });

  it("reserves the deepseek provider id for direct mode", () => {
    const plan = planOf(
      payload({
        UPSTREAM_FORMAT: "anthropic",
        ANTHROPIC_MODEL: "deepseek-flash",
        CODEX_PROVIDER: "deepseek",
      }),
    );
    expect(plan.mode).toBe("bridge");
    expect(plan.provider).toBe("bridge");
    expect(plan.warnings.some((warning) => warning.includes("保留的 provider 名"))).toBe(true);
  });

  it("warns for reseller and protocol-conversion cases", () => {
    const reseller = planOf(
      payload({
        RESPONSE_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
        RESPONSE_MODEL: "deepseek-v4-flash",
      }),
    );
    expect(reseller.mode).toBe("bridge");
    expect(reseller.warnings.some((warning) => warning.includes("非原生"))).toBe(true);

    const chat = planOf(
      payload({
        UPSTREAM_FORMAT: "openai",
        OPENAI_BASE_URL: "https://api.deepseek.com/v1",
        OPENAI_MODEL: "deepseek-flash",
      }),
    );
    expect(chat.warnings.some((warning) => warning.includes("Chat"))).toBe(true);

    const anthropic = planOf(
      payload({
        UPSTREAM_FORMAT: "anthropic",
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_MODEL: "deepseek-flash",
      }),
    );
    expect(anthropic.warnings.some((warning) => warning.includes("Anthropic"))).toBe(true);
  });
});
