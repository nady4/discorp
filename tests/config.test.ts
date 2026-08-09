import { describe, expect, it } from "vitest";
import { loadEnv, EnvError } from "../src/config/env.js";
import { getModelCost, estimateCostUsd } from "../src/config/models.js";
import { parseMode, modeLevel, ORG_MODE_LEVELS } from "../src/config/modes.js";
import { GuildMode } from "@prisma/client";

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DISCORD_TOKEN: "test-token",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    AI_MODEL: "deepseek-v4-flash-0731",
    ...overrides,
  };
}

describe("loadEnv", () => {
  it("loads a minimal valid configuration", () => {
    const env = loadEnv(baseEnv());
    expect(env.AI_PROVIDER).toBe("openai");
    expect(env.AI_MODEL).toBe("deepseek-v4-flash-0731");
    expect(env.DEFAULT_GUILD_MODE).toBe("standard");
    expect(env.AI_EMBEDDING_DIM).toBe(1024);
  });

  it("accepts ollama without an API key", () => {
    const env = loadEnv(baseEnv({ AI_PROVIDER: "ollama", AI_MODEL: "llama3.1" }));
    expect(env.AI_PROVIDER).toBe("ollama");
  });

  it("parses admin user ids into an array", () => {
    const env = loadEnv(baseEnv({ ADMIN_USER_IDS: "111, 222 ,333" }));
    expect(env.ADMIN_USER_IDS).toEqual(["111", "222", "333"]);
  });

  it("throws when DISCORD_TOKEN is missing", () => {
    const { DISCORD_TOKEN, ...rest } = baseEnv();
    expect(() => loadEnv(rest)).toThrow(EnvError);
  });

  it("throws on unknown AI_PROVIDER", () => {
    expect(() => loadEnv(baseEnv({ AI_PROVIDER: "watson" }))).toThrow(EnvError);
  });

  it("rejects negative budget", () => {
    expect(() => loadEnv(baseEnv({ DEFAULT_MONTHLY_BUDGET: "-5" }))).toThrow(EnvError);
  });
});

describe("model pricing", () => {
  const envStub = { FALLBACK_COST_PER_1M_INPUT: 1, FALLBACK_COST_PER_1M_OUTPUT: 3 };

  it("returns known prices for deepseek", () => {
    const cost = getModelCost("deepseek-v4-flash-0731", envStub);
    expect(cost.inputPer1M).toBe(0.35);
  });

  it("falls back for unknown models", () => {
    const cost = getModelCost("my-custom-model", envStub);
    expect(cost.inputPer1M).toBe(1);
    expect(cost.outputPer1M).toBe(3);
  });

  it("estimates cost from token usage", () => {
    // 1M input tokens at $0.35 + 0.5M output at $1.40
    const usd = estimateCostUsd("deepseek-v4-flash-0731", 1_000_000, 500_000, envStub);
    expect(usd).toBeCloseTo(1.05, 5);
  });
});

describe("org modes", () => {
  it("maps modes to levels", () => {
    expect(ORG_MODE_LEVELS.LIGHTWEIGHT).toBe(1);
    expect(ORG_MODE_LEVELS.STANDARD).toBe(2);
    expect(ORG_MODE_LEVELS.AUTONOMOUS).toBe(3);
  });

  it("parses user input into modes", () => {
    expect(parseMode("1")).toBe(GuildMode.LIGHTWEIGHT);
    expect(parseMode("lightweight")).toBe(GuildMode.LIGHTWEIGHT);
    expect(parseMode("3")).toBe(GuildMode.AUTONOMOUS);
    expect(parseMode("autonomous")).toBe(GuildMode.AUTONOMOUS);
    expect(parseMode("bogus")).toBeNull();
  });

  it("modeLevel returns the numeric level", () => {
    expect(modeLevel(GuildMode.AUTONOMOUS)).toBe(3);
  });
});
