import { describe, expect, it } from "vitest";
import { canonicalDeepseekModel, isNativeDeepseekUrl } from "../config";

describe("native deepseek UI predicate", () => {
  it("accepts only the exact https host with supported paths", () => {
    for (const url of [
      "https://api.deepseek.com",
      "https://api.deepseek.com/",
      "https://api.deepseek.com/v1",
      "https://api.deepseek.com/v1/",
      "https://api.deepseek.com/responses",
      "https://api.deepseek.com/v1/responses",
    ]) {
      expect(isNativeDeepseekUrl(url, "responses"), url).toBe(true);
    }
    expect(isNativeDeepseekUrl("https://api.deepseek.com/v1", "chat")).toBe(true);
    expect(isNativeDeepseekUrl("https://api.deepseek.com/anthropic", "anthropic")).toBe(true);
    expect(isNativeDeepseekUrl("https://api.deepseek.com/anthropic", "responses")).toBe(false);
    expect(isNativeDeepseekUrl("https://api.deepseek.com/v1", "anthropic")).toBe(false);

    for (const url of [
      "http://api.deepseek.com",
      "https://api.deepseek.com:8443",
      "https://foo.api.deepseek.com",
      "https://api.deepseek.com.evil.test",
      "https://ark.cn-beijing.volces.com/api/v3",
      "https://api.deepseek.com/v1/chat/completions",
      "https://api.deepseek.com/?x=1",
    ]) {
      expect(isNativeDeepseekUrl(url), url).toBe(false);
    }
  });

  it("maps documented legacy model names", () => {
    expect(canonicalDeepseekModel("deepseek-flash")).toBe("deepseek-flash");
    expect(canonicalDeepseekModel("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(canonicalDeepseekModel("deepseek-v4-flash")).toBe("deepseek-flash");
    expect(canonicalDeepseekModel("deepseek-v4-flash-vision-exp")).toBe("deepseek-flash");
    expect(canonicalDeepseekModel("deepseek-chat")).toBeNull();
  });
});
