import { MemoryKind } from "@prisma/client";

/** Normalize a tool-supplied kind into a valid MemoryKind, defaulting to FACT. */
export function normalizeKind(raw: unknown): MemoryKind {
  const value = String(raw ?? MemoryKind.FACT).toUpperCase();
  return (Object.values(MemoryKind) as string[]).includes(value) ? (value as MemoryKind) : MemoryKind.FACT;
}
