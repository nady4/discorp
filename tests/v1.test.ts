import { describe, expect, it } from "vitest";
import { pluginSchema } from "../src/plugins/index.js";
import { validateSwarmInput } from "../src/orchestration/swarm.js";

describe("plugin manifest schema", () => {
  it("accepts a minimal valid manifest", () => {
    const manifest = pluginSchema.parse({
      id: "my-plugin",
      name: "My plugin",
      entry: "index.js",
      tools: [{ name: "my_tool", description: "does things", parameters: {} }],
    });
    expect(manifest.version).toBe("0.0.0");
    expect(manifest.tools[0].name).toBe("my_tool");
  });

  it("defaults tools to an empty list", () => {
    const manifest = pluginSchema.parse({ id: "empty", name: "Empty", entry: "index.js" });
    expect(manifest.tools).toEqual([]);
  });

  it("rejects invalid plugin ids", () => {
    expect(() => pluginSchema.parse({ id: "Bad Id!", name: "x", entry: "index.js" })).toThrow();
  });

  it("rejects entries outside the plugin directory", () => {
    expect(() => pluginSchema.parse({ id: "x", name: "x", entry: "../../evil.js" })).toThrow();
  });

  it("rejects tool names that are not snake_case", () => {
    expect(() =>
      pluginSchema.parse({ id: "x", name: "x", entry: "index.js", tools: [{ name: "Bad Name" }] }),
    ).toThrow();
  });
});

describe("validateSwarmInput", () => {
  it("accepts a reasonable agent set", () => {
    expect(() => validateSwarmInput(["cto", "developer", "qa"])).not.toThrow();
  });

  it("rejects an empty swarm", () => {
    expect(() => validateSwarmInput([])).toThrow(/at least one agent/);
  });

  it("rejects swarms larger than 8 agents", () => {
    expect(() => validateSwarmInput(["a", "b", "c", "d", "e", "f", "g", "h", "i"])).toThrow(/at most 8/);
  });

  it("rejects malformed agent ids", () => {
    expect(() => validateSwarmInput(["bad agent id"])).toThrow(/Invalid agent id/);
  });
});
