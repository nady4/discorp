import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentRegistry } from "../src/agents/registry.js";

describe("AgentRegistry", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "discorp-agents-"));
    await writeFile(
      path.join(dir, "cto.json"),
      JSON.stringify({
        name: "CTO",
        role: "Technical Director",
        responsibilities: ["Architecture decisions", "Technical reviews"],
        tools: ["github", "filesystem"],
        permissions: ["read_code"],
        persona: "You are the CTO.",
      }),
    );
    await writeFile(
      path.join(dir, "bad.json"),
      "{ not valid json",
    );
    await writeFile(
      path.join(dir, "invalid.json"),
      JSON.stringify({ name: "x", persona: "" }), // empty persona → invalid
    );
    await writeFile(
      path.join(dir, "sales.json"),
      JSON.stringify({
        name: "Sales",
        role: "Sales Lead",
        persona: "You sell.",
        responsibilities: ["Pipeline", "Outreach"],
        tools: ["memory", "report"],
        custom: true,
        modeMin: 2,
      }),
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads valid agent files and ignores broken ones", async () => {
    const registry = new AgentRegistry(dir);
    await registry.load();
    const names = registry.all.map((e) => e.definition.id).sort();
    expect(names).toEqual(["cto", "sales"]);
  });

  it("defaults id from filename", async () => {
    const registry = new AgentRegistry(dir);
    await registry.load();
    // cto.json carries no id field; the registry derives it from the filename
    expect(registry.get("cto")?.name).toBe("CTO");
  });

  it("keeps custom flag and modeMin from the file", async () => {
    const registry = new AgentRegistry(dir);
    await registry.load();
    const sales = registry.get("sales");
    expect(sales?.custom).toBe(true);
    expect(sales?.modeMin).toBe(2);
    expect(sales?.tools).toContain("memory");
  });

  it("exposes agents active at a level", async () => {
    const registry = new AgentRegistry(dir);
    await registry.load();
    const level1 = registry.activeAtLevel(1).map((a) => a.id);
    expect(level1).toContain("cto");
    expect(level1).not.toContain("sales");
    const level2 = registry.activeAtLevel(2).map((a) => a.id);
    expect(level2).toContain("sales");
  });

  it("adds custom agents to disk and reloads", async () => {
    const registry = new AgentRegistry(dir);
    await registry.load();
    await registry.addCustomAgent({
      id: "support",
      name: "Support",
      role: "Support Lead",
      persona: "You help users.",
      responsibilities: ["Triage"],
      tools: ["memory"],
      description: "",
      permissions: [],
      modeMin: 1,
      isCore: false,
    });
    expect(registry.get("support")?.custom).toBe(true);
    const onDisk = JSON.parse(await readFile(path.join(dir, "support.json"), "utf8")) as { custom: boolean };
    expect(onDisk.custom).toBe(true);
  });
});
