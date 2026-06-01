import { describe, it, expect, beforeEach } from "vitest";
import { clearSettingsCache, loadSettings } from "../config";

describe("config", () => {
  beforeEach(() => {
    clearSettingsCache();
  });

  it("openai base url falls back to anthropic base", () => {
    const settings = loadSettings({
      UPSTREAM_FORMAT: "openai",
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/v1",
    });
    expect(settings.openaiBaseUrl).toBe("https://api.deepseek.com/v1");
  });
});
