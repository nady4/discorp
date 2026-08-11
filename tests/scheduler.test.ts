import { describe, expect, it } from "vitest";
import { GuildMode } from "@prisma/client";
import { desiredJobsFor } from "../src/workers/jobs.js";

function guild(mode: GuildMode, sleepMode = false) {
  return { id: "g1", mode, sleepMode };
}

describe("desiredJobsFor", () => {
  it("schedules nothing for lightweight orgs", () => {
    expect(desiredJobsFor(guild(GuildMode.LIGHTWEIGHT))).toEqual([]);
  });

  it("schedules only the daily review for standard orgs", () => {
    const jobs = desiredJobsFor(guild(GuildMode.STANDARD));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].queue).toBe("review");
    expect(jobs[0].cron).toBe("0 18 * * *");
    expect(jobs[0].name).toBe("review:daily:g1");
  });

  it("schedules daily review + autonomous sessions for autonomous orgs", () => {
    const jobs = desiredJobsFor(guild(GuildMode.AUTONOMOUS));
    expect(jobs.map((j) => j.queue)).toEqual(["review", "autonomous"]);
    expect(jobs[1].cron).toBe("0 */6 * * *");
  });

  it("returns nothing while the org is sleeping", () => {
    expect(desiredJobsFor(guild(GuildMode.AUTONOMOUS, true))).toEqual([]);
  });
});
