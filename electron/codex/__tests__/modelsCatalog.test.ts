import { describe, expect, it } from "vitest";
import {
  CatalogError,
  loadOfficialCatalog,
  mergeDeepSeekCatalog,
  validateOfficialCatalog,
} from "../modelsCatalog";

describe("modelsCatalog", () => {
  it("loads the official two-model catalog", () => {
    const catalog = loadOfficialCatalog();
    expect(catalog.models.map((model) => model.slug).sort()).toEqual([
      "deepseek-flash",
      "deepseek-v4-pro",
    ]);
    expect(() => validateOfficialCatalog(catalog)).not.toThrow();

    const flash = catalog.models.find((model) => model.slug === "deepseek-flash")!;
    expect(flash.context_window).toBe(1048576);
    expect(flash.input_modalities).toContain("image");
    expect(
      (flash.supported_reasoning_levels as Array<{ effort: string }>).map((item) => item.effort),
    ).toEqual(["low", "high", "max"]);
    expect(flash.supports_reasoning_summaries).toBe(true);
    expect(flash.apply_patch_tool_type).toBe("freeform");

    const pro = catalog.models.find((model) => model.slug === "deepseek-v4-pro")!;
    expect(pro.input_modalities).not.toContain("image");
  });

  it("merges without touching other providers and cleans legacy slugs", () => {
    const existing = {
      version: 2,
      models: [
        { slug: "gpt-5.5", context_window: 400000 },
        { slug: "deepseek-v4-flash" },
        { slug: "deepseek-flash", context_window: 1 },
      ],
    };
    const { catalog, warnings } = mergeDeepSeekCatalog(existing);
    expect(catalog.version).toBe(2);
    const slugs = catalog.models.map((model) => model.slug);
    expect(slugs).toContain("gpt-5.5");
    expect(slugs).toContain("deepseek-flash");
    expect(slugs).toContain("deepseek-v4-pro");
    expect(slugs).not.toContain("deepseek-v4-flash");
    expect(slugs.filter((slug) => slug === "deepseek-flash")).toHaveLength(1);

    const flash = catalog.models.find((model) => model.slug === "deepseek-flash")!;
    expect(flash.context_window).toBe(1048576);
    expect(warnings.some((warning) => warning.includes("deepseek-v4-flash"))).toBe(true);
  });

  it("preserves unknown deepseek entries with a warning", () => {
    const { catalog, warnings } = mergeDeepSeekCatalog({ models: [{ slug: "deepseek-v9" }] });
    expect(catalog.models.map((model) => model.slug)).toContain("deepseek-v9");
    expect(warnings.some((warning) => warning.includes("deepseek-v9"))).toBe(true);
  });

  it("rejects invalid catalog shapes", () => {
    expect(() => mergeDeepSeekCatalog({ models: "nope" })).toThrow(CatalogError);
    expect(() => mergeDeepSeekCatalog({ models: [{ name: "missing slug" }] })).toThrow(
      CatalogError,
    );
    expect(() => mergeDeepSeekCatalog({ models: [{ slug: "x" }] })).not.toThrow();
  });
});
