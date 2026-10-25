import { describe, expect, it } from "vitest";
import {
  ConfigData,
  EMPTY_GROUPS,
  UpstreamGroup,
  UpstreamGroupMap,
  createGroup,
  findGroup,
  isGroupDirty,
  matchAppliedGroup,
  nextGroupName,
  normalizeGroups,
  removeGroup,
  renameGroup,
  uniqueName,
  upsertGroupValues,
} from "../config";

function cfg(overrides: Partial<ConfigData> = {}): ConfigData {
  return {
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_MODEL: "",
    ANTHROPIC_BASE_URL: "",
    OPENAI_API_KEY: "",
    OPENAI_BASE_URL: "",
    OPENAI_MODEL: "",
    RESPONSE_API_KEY: "",
    RESPONSE_BASE_URL: "",
    RESPONSE_MODEL: "",
    CODEX_CHAT_REASONING_MODE: "auto",
    CODEX_MODEL: "",
    CODEX_PROVIDER: "bridge",
    BRIDGE_PORT: "8000",
    CODEX_CONFIG_PATH: "",
    UPSTREAM_FORMAT: "anthropic",
    ...overrides,
  };
}

function group(overrides: Partial<UpstreamGroup> = {}): UpstreamGroup {
  return {
    id: "g1",
    name: "G1",
    apiKey: "key-1",
    model: "model-1",
    baseUrl: "https://one.example",
    selectedAt: 0,
    ...overrides,
  };
}

function mapWith(format: "anthropic" | "openai" | "response", list: UpstreamGroup[]): UpstreamGroupMap {
  return { ...EMPTY_GROUPS, [format]: list };
}

describe("normalizeGroups", () => {
  it("returns empty lists for missing or invalid input", () => {
    expect(normalizeGroups(undefined)).toEqual(EMPTY_GROUPS);
    expect(normalizeGroups(null)).toEqual(EMPTY_GROUPS);
    expect(normalizeGroups({})).toEqual(EMPTY_GROUPS);
    expect(normalizeGroups({ anthropic: "nope" })).toEqual(EMPTY_GROUPS);
  });

  it("drops invalid entries and fills missing fields", () => {
    const result = normalizeGroups({
      anthropic: [null, 1, { name: "ok", id: "a" }, { name: "bad-id", id: 7, selectedAt: "x" }],
      openai: [],
      response: [{ name: "resp", apiKey: "k" }],
    });
    expect(result.anthropic).toEqual([
      { id: "a", name: "ok", apiKey: "", model: "", baseUrl: "", selectedAt: 0 },
      { id: "7", name: "bad-id", apiKey: "", model: "", baseUrl: "", selectedAt: 0 },
    ]);
    expect(result.response[0]).toEqual({
      id: "",
      name: "resp",
      apiKey: "k",
      model: "",
      baseUrl: "",
      selectedAt: 0,
    });
  });
});

describe("findGroup", () => {
  it("finds only within the requested format", () => {
    const map = { ...mapWith("anthropic", [group()]), openai: [group({ id: "o1" })] };
    expect(findGroup(map, "anthropic", "g1")?.id).toBe("g1");
    expect(findGroup(map, "openai", "g1")).toBeUndefined();
    expect(findGroup(map, "anthropic", null)).toBeUndefined();
  });
});

describe("isGroupDirty", () => {
  it("is false without a group or when all three values match", () => {
    const config = cfg({ ANTHROPIC_AUTH_TOKEN: "key-1", ANTHROPIC_MODEL: "model-1", ANTHROPIC_BASE_URL: "https://one.example" });
    expect(isGroupDirty(config, undefined, "anthropic")).toBe(false);
    expect(isGroupDirty(config, group(), "anthropic")).toBe(false);
  });

  it("detects a difference in any preset field", () => {
    const g = group();
    expect(isGroupDirty(cfg({ ANTHROPIC_AUTH_TOKEN: "other" }), g, "anthropic")).toBe(true);
    expect(isGroupDirty(cfg({ ANTHROPIC_MODEL: "other" }), g, "anthropic")).toBe(true);
    expect(isGroupDirty(cfg({ ANTHROPIC_BASE_URL: "other" }), g, "anthropic")).toBe(true);
  });

  it("ignores fields belonging to another format", () => {
    const g = group();
    const config = cfg({
      ANTHROPIC_AUTH_TOKEN: "key-1",
      ANTHROPIC_MODEL: "model-1",
      ANTHROPIC_BASE_URL: "https://one.example",
      OPENAI_MODEL: "other",
    });
    expect(isGroupDirty(config, g, "anthropic")).toBe(false);
  });
});

describe("matchAppliedGroup", () => {
  it("matches by exact values within the format", () => {
    const anthropicConfig = cfg({
      ANTHROPIC_AUTH_TOKEN: "k",
      ANTHROPIC_MODEL: "m",
      ANTHROPIC_BASE_URL: "u",
    });
    const openaiConfig = cfg({
      UPSTREAM_FORMAT: "openai",
      OPENAI_API_KEY: "k",
      OPENAI_MODEL: "m",
      OPENAI_BASE_URL: "u",
    });
    const anthropicGroup = group({ id: "a1", apiKey: "k", model: "m", baseUrl: "u" });
    const map = {
      ...mapWith("openai", [group({ id: "o1", apiKey: "k", model: "m", baseUrl: "u" })]),
      anthropic: [anthropicGroup],
    };
    expect(matchAppliedGroup(map, "openai", openaiConfig)?.id).toBe("o1");
    expect(matchAppliedGroup(map, "anthropic", anthropicConfig)?.id).toBe("a1");
  });

  it("never matches a group from another format", () => {
    const openaiConfig = cfg({
      UPSTREAM_FORMAT: "openai",
      OPENAI_API_KEY: "k",
      OPENAI_MODEL: "m",
      OPENAI_BASE_URL: "u",
    });
    const map = {
      ...mapWith("openai", []),
      anthropic: [group({ id: "a1", apiKey: "k", model: "m", baseUrl: "u" })],
    };
    expect(matchAppliedGroup(map, "openai", openaiConfig)).toBeUndefined();
  });

  it("returns undefined when no values match", () => {
    const config = cfg({ ANTHROPIC_AUTH_TOKEN: "different" });
    expect(matchAppliedGroup(mapWith("anthropic", [group()]), "anthropic", config)).toBeUndefined();
  });

  it("prefers the most recently committed group when values are identical", () => {
    const config = cfg({ ANTHROPIC_AUTH_TOKEN: "key-1", ANTHROPIC_MODEL: "model-1", ANTHROPIC_BASE_URL: "https://one.example" });
    const map = mapWith("anthropic", [
      group({ id: "old", selectedAt: 100 }),
      group({ id: "new", selectedAt: 200 }),
    ]);
    expect(matchAppliedGroup(map, "anthropic", config)?.id).toBe("new");
  });
});

describe("naming", () => {
  it("increments the default name past used names", () => {
    expect(nextGroupName([])).toBe("新分组1");
    expect(nextGroupName([group({ name: "新分组1" }), group({ name: "新分组2" })])).toBe("新分组3");
  });

  it("trims, defaults empty names, and suffixes duplicates", () => {
    const list = [group({ name: "A" }), group({ id: "g2", name: "A (2)" })];
    expect(uniqueName("  B  ", list)).toBe("B");
    expect(uniqueName("   ", [])).toBe("新分组1");
    expect(uniqueName("A", list)).toBe("A (3)");
    expect(uniqueName("A", list, "g1")).toBe("A");
  });
});

describe("createGroup", () => {
  it("snapshots the current format values and does not mutate the input", () => {
    const config = cfg({
      ANTHROPIC_AUTH_TOKEN: "k",
      ANTHROPIC_MODEL: "m",
      ANTHROPIC_BASE_URL: "u",
      OPENAI_MODEL: "ignored",
    });
    const original = mapWith("anthropic", []);
    const { groups, group: created } = createGroup(original, "anthropic", "  My Group  ", config, 123);

    expect(created).toMatchObject({
      name: "My Group",
      apiKey: "k",
      model: "m",
      baseUrl: "u",
      selectedAt: 123,
    });
    expect(created.id).toBeTruthy();
    expect(groups.anthropic).toEqual([created]);
    expect(original.anthropic).toEqual([]);
    expect(groups.openai).toEqual([]);
  });

  it("uses a unique default name and suffixes duplicates", () => {
    const config = cfg();
    const existing = mapWith("anthropic", [group({ name: "新分组1" })]);
    const first = createGroup(existing, "anthropic", "", config, 1);
    expect(first.group.name).toBe("新分组2");
    const second = createGroup(existing, "anthropic", "新分组1", config, 2);
    expect(second.group.name).toBe("新分组1 (2)");
  });
});

describe("upsertGroupValues", () => {
  it("updates the three preset fields and selectedAt for the target group only", () => {
    const map = {
      ...mapWith("openai", [
        group({ id: "o1", apiKey: "old", model: "old", baseUrl: "old", selectedAt: 1 }),
        group({ id: "o2", apiKey: "keep", model: "keep", baseUrl: "keep", selectedAt: 2 }),
      ]),
      anthropic: [group({ id: "a1", apiKey: "keep" })],
    };
    const config = cfg({
      UPSTREAM_FORMAT: "openai",
      OPENAI_API_KEY: "new-key",
      OPENAI_MODEL: "new-model",
      OPENAI_BASE_URL: "new-url",
    });
    const next = upsertGroupValues(map, "openai", "o1", config, 99);

    expect(next.openai[0]).toMatchObject({
      id: "o1",
      apiKey: "new-key",
      model: "new-model",
      baseUrl: "new-url",
      selectedAt: 99,
    });
    expect(next.openai[1]).toBe(map.openai[1]);
    expect(next.anthropic).toBe(map.anthropic);
    expect(map.openai[0].apiKey).toBe("old");
  });

  it("never creates a missing group", () => {
    const map = mapWith("anthropic", []);
    expect(upsertGroupValues(map, "anthropic", "missing", cfg(), 1)).toBe(map);
  });
});

describe("renameGroup", () => {
  it("renames without touching values", () => {
    const map = mapWith("anthropic", [group()]);
    const next = renameGroup(map, "anthropic", "g1", "  Renamed  ");
    expect(next.anthropic[0]).toEqual({ ...group(), name: "Renamed" });
    expect(map.anthropic[0].name).toBe("G1");
  });

  it("keeps the current name for an empty draft and suffixes duplicates", () => {
    const map = mapWith("anthropic", [group({ name: "A" }), group({ id: "g2", name: "B" })]);
    expect(renameGroup(map, "anthropic", "g1", "   ")).toBe(map);
    expect(renameGroup(map, "anthropic", "g1", "A")).toBe(map);
    expect(renameGroup(map, "anthropic", "g1", "B").anthropic[0].name).toBe("B (2)");
  });

  it("ignores unknown ids", () => {
    const map = mapWith("anthropic", [group()]);
    expect(renameGroup(map, "anthropic", "missing", "X")).toBe(map);
  });
});

describe("removeGroup", () => {
  it("removes only the target group in the given format", () => {
    const map = {
      ...mapWith("anthropic", [group({ id: "g1" }), group({ id: "g2" })]),
      openai: [group({ id: "g1" })],
    };
    const next = removeGroup(map, "anthropic", "g1");
    expect(next.anthropic.map((g) => g.id)).toEqual(["g2"]);
    expect(next.openai).toBe(map.openai);
    expect(map.anthropic).toHaveLength(2);
  });
});
