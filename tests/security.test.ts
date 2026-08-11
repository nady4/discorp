import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSafePath } from "../src/agents/tools/filesystem.js";
import { normalizeKind } from "../src/utils/memoryKind.js";
import { MemoryKind } from "@prisma/client";

describe("filesystem sandbox", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "discorp-sandbox-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects path traversal outside the root", async () => {
    await expect(resolveSafePath("../outside.txt", root)).rejects.toThrow(/escapes/);
    await expect(resolveSafePath("/etc/passwd", root)).rejects.toThrow(/escapes/);
  });

  it("resolves nested relative paths inside the root", async () => {
    const resolved = await resolveSafePath("a/b/c.txt", root);
    expect(resolved.startsWith(root + path.sep)).toBe(true);
  });

  it("blocks symlinks that point outside the sandbox", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "discorp-outside-"));
    const link = path.join(root, "evil");
    await fs.symlink(outside, link);
    try {
      await expect(resolveSafePath("evil/secret.txt", root)).rejects.toThrow(/outside/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("blocks writes through a directory symlink that escapes", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "discorp-outside-dir-"));
    const dir = path.join(root, "docs");
    await fs.mkdir(dir);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.symlink(outside, dir);
    try {
      await expect(resolveSafePath("docs/new.txt", root)).rejects.toThrow(/outside/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("allows symlinks that stay inside the sandbox", async () => {
    const target = path.join(root, "real");
    await fs.mkdir(target);
    await fs.symlink(target, path.join(root, "alias"));
    const resolved = await resolveSafePath("alias/inner.txt", root);
    expect(resolved.startsWith(target + path.sep)).toBe(true);
  });
});

describe("normalizeKind", () => {
  it("defaults to FACT when kind is missing", () => {
    expect(normalizeKind(undefined)).toBe(MemoryKind.FACT);
    expect(normalizeKind(null)).toBe(MemoryKind.FACT);
  });

  it("normalizes case-insensitive valid kinds", () => {
    expect(normalizeKind("decision")).toBe(MemoryKind.DECISION);
    expect(normalizeKind("LESSON")).toBe(MemoryKind.LESSON);
  });

  it("falls back to FACT for garbage input", () => {
    expect(normalizeKind("UNDEFINED")).toBe(MemoryKind.FACT);
    expect(normalizeKind("banana")).toBe(MemoryKind.FACT);
    expect(normalizeKind(42)).toBe(MemoryKind.FACT);
  });
});
