import { GuildMode } from "@prisma/client";

/**
 * Organization intensity levels. Each level gates which agents are active,
 * which background workers run, and how much memory is kept.
 *
 * Level 1 (LIGHTWEIGHT): low-cost personal assistant. Reactive only.
 * Level 2 (STANDARD):    personal AI company assistant. Scheduled reviews.
 * Level 3 (AUTONOMOUS):  full AI organization simulation. Background work.
 */
export const ORG_MODE_LEVELS = {
  LIGHTWEIGHT: 1,
  STANDARD: 2,
  AUTONOMOUS: 3,
} as const;

export type OrgModeLevel = (typeof ORG_MODE_LEVELS)[keyof typeof ORG_MODE_LEVELS];

export type OrgMode = keyof typeof ORG_MODE_LEVELS;

export function modeLevel(mode: GuildMode): OrgModeLevel {
  return ORG_MODE_LEVELS[mode];
}

export function parseMode(input: string): GuildMode | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "1" || normalized === "lightweight" || normalized === "light") return GuildMode.LIGHTWEIGHT;
  if (normalized === "2" || normalized === "standard") return GuildMode.STANDARD;
  if (normalized === "3" || normalized === "autonomous" || normalized === "auto") return GuildMode.AUTONOMOUS;
  return null;
}
