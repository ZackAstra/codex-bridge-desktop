import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  getSectionKeyRaw,
  getSectionRaw,
  getTopLevelRaw,
  removeSection,
  removeSectionKey,
  removeTopLevelKey,
  replaceSection,
  setTopLevelKeys,
  upsertSectionKey,
  upsertTopLevelKey,
  validateTomlText,
  writeTextAtomic,
} from "../toml";

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

[desktop]
localeOverride = "zh-CN"

[projects.'c:\\work']
trust_level = "trusted"

[mcp_servers.foo]
args = [
  "--x",
]
`;

describe("toml editor", () => {
  it("validates a realistic config", () => {
    expect(validateTomlText(FIXTURE)).toEqual([]);
  });

  it("inserts top-level keys before the first table", () => {
    const next = upsertTopLevelKey(FIXTURE, "preferred_auth_method", '"apikey"');
    expect(next.indexOf("preferred_auth_method")).toBeGreaterThan(-1);
    expect(next.indexOf("preferred_auth_method")).toBeLessThan(
      next.indexOf("[model_providers.bridge]"),
    );
    expect(next).toContain('localeOverride = "zh-CN"');
  });

  it("inserts missing keys as one block and preserves existing keys", () => {
    const next = setTopLevelKeys(FIXTURE, [
      { key: "model", raw: '"deepseek-flash"' },
      { key: "model_provider", raw: '"deepseek"' },
      { key: "preferred_auth_method", raw: '"apikey"' },
      { key: "forced_login_method", raw: '"api"' },
    ]);
    expect(next).toContain('model = "deepseek-flash"');
    expect(next).toContain('model_provider = "deepseek"');
    expect(next.indexOf("preferred_auth_method")).toBeLessThan(
      next.indexOf("[model_providers.bridge]"),
    );
    expect(next.indexOf("forced_login_method")).toBeLessThan(
      next.indexOf("[model_providers.bridge]"),
    );
    expect(next.match(/^model = /gm)).toHaveLength(1);
    expect(next.match(/^model_provider = /gm)).toHaveLength(1);
  });

  it("removes a multi-line top-level value", () => {
    const next = removeTopLevelKey(FIXTURE, "notify");
    expect(next).not.toContain("notify");
    expect(next).not.toContain('"notify.exe"');
    expect(next).toContain('model_reasoning_effort = "medium"');
  });

  it("merges the desktop key without duplicating the section", () => {
    const next = upsertSectionKey(
      FIXTURE,
      "desktop",
      "enabled-reasoning-efforts",
      '["low", "medium", "high", "xhigh", "ultra", "max"]',
    );
    expect(next.match(/^\[desktop\]$/gm)).toHaveLength(1);
    expect(next).toContain('localeOverride = "zh-CN"');
    expect(next).toContain(
      'enabled-reasoning-efforts = ["low", "medium", "high", "xhigh", "ultra", "max"]',
    );

    const removed = removeSectionKey(next, "desktop", "enabled-reasoning-efforts");
    expect(removed).not.toContain("enabled-reasoning-efforts");
    expect(removed).toContain('localeOverride = "zh-CN"');
  });

  it("replaces and removes a provider section while preserving the rest", () => {
    const replaced = replaceSection(FIXTURE, "model_providers.bridge", [
      'name = "Local Bridge (deepseek-flash)"',
      'base_url = "http://127.0.0.1:8123"',
      'wire_api = "responses"',
      "requires_openai_auth = false",
      "stream_idle_timeout_ms = 300000",
    ]);
    expect(replaced).toContain('base_url = "http://127.0.0.1:8123"');
    expect(replaced).toContain("stream_idle_timeout_ms = 300000");
    expect(replaced).not.toContain('name = "Local Bridge"');
    expect(replaced).toContain('localeOverride = "zh-CN"');

    const removed = removeSection(replaced, "model_providers.bridge");
    expect(removed).not.toContain("[model_providers.bridge]");
    expect(removed).toContain('localeOverride = "zh-CN"');
  });

  it("captures raw values for the sidecar", () => {
    expect(getTopLevelRaw(FIXTURE, "model")).toEqual({ exists: true, raw: '"gpt-5.5"' });
    expect(getTopLevelRaw(FIXTURE, "notify").raw).toContain('"notify.exe"');
    expect(getTopLevelRaw(FIXTURE, "missing")).toEqual({ exists: false });
    expect(getSectionKeyRaw(FIXTURE, "desktop", "localeOverride")).toEqual({
      exists: true,
      raw: '"zh-CN"',
    });
    expect(getSectionRaw(FIXTURE, "model_providers.bridge").raw).toContain(
      "[model_providers.bridge]",
    );
  });

  it("normalizes CRLF and writes atomically", () => {
    const crlf = 'model = "a"\r\n\r\n[desktop]\r\nlocaleOverride = "zh-CN"\r\n';
    const next = upsertTopLevelKey(crlf, "model_provider", '"bridge"');
    expect(next).not.toContain("\r");
    expect(next.indexOf("model_provider")).toBeLessThan(next.indexOf("[desktop]"));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toml-test-"));
    const filePath = path.join(dir, "config.toml");
    try {
      writeTextAtomic(filePath, next);
      expect(fs.readFileSync(filePath, "utf-8")).toBe(next);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects duplicate keys and sections", () => {
    expect(validateTomlText('model = "a"\nmodel = "b"\n')).toContain(
      "duplicate top-level key: model",
    );
    expect(validateTomlText("[desktop]\n[desktop]\n")).toContain("duplicate section: [desktop]");
    expect(validateTomlText('x = "unterminated\n')).not.toHaveLength(0);
  });
});
