import { describe, expect, it } from "vitest";
import { DiscorpError, CostGuardError, userMessage } from "../src/utils/errors.js";
import { RateLimiter } from "../src/utils/rateLimit.js";
import { route } from "../src/server/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";

describe("userMessage", () => {
  it("returns the curated message for DiscorpError", () => {
    const err = new DiscorpError("internal detail", "Friendly message");
    expect(userMessage(err)).toBe("Friendly message");
  });

  it("falls back to the raw message when no curated one exists", () => {
    expect(userMessage(new DiscorpError("plain"))).toBe("plain");
    expect(userMessage(new CostGuardError("budget exceeded"))).toBe("⛔ budget exceeded");
  });

  it("returns a generic message for unknown errors (no leak)", () => {
    expect(userMessage(new Error("pg connection refused: secret-dsn"))).toBe("Something went wrong. Please try again.");
    expect(userMessage("random string")).toBe("Something went wrong. Please try again.");
  });
});

describe("RateLimiter", () => {
  it("allows up to max requests within the window", () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.try("k")).toBe(true);
    expect(limiter.try("k")).toBe(true);
    expect(limiter.try("k")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.try("a")).toBe(true);
    expect(limiter.try("a")).toBe(false);
    expect(limiter.try("b")).toBe(true);
  });

  it("resets after the window expires", () => {
    const limiter = new RateLimiter(1, 10);
    expect(limiter.try("k")).toBe(true);
    expect(limiter.try("k")).toBe(false);
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(limiter.try("k")).toBe(true);
        resolve(null);
      }, 25);
    });
  });
});

function respond(): { res: ServerResponse; state: { body: string; status: number } } {
  const state = { body: "", status: 200 };
  const res = {
    writeHead(status: number) {
      state.status = status;
      return res;
    },
    end(body: string) {
      state.body = body ?? "";
      return res;
    },
  } as unknown as ServerResponse;
  return { res, state };
}

function request(url: string): IncomingMessage {
  return { url, method: "GET", headers: { host: "localhost" } } as unknown as IncomingMessage;
}

describe("orchestration API routes (no DB)", () => {
  it("answers /healthz", async () => {
    const r = respond();
    await route(request("/healthz"), r.res);
    expect(r.state.status).toBe(200);
    expect(JSON.parse(r.state.body).ok).toBe(true);
  });

  it("serves the dashboard at /", async () => {
    const r = respond();
    await route(request("/"), r.res);
    expect(r.state.status).toBe(200);
    expect(r.state.body).toContain("<!doctype html>");
  });

  it("rejects unknown paths with 404", async () => {
    const r = respond();
    await route(request("/api/nope"), r.res);
    expect(r.state.status).toBe(404);
  });

  it("requires guildId for guild-scoped endpoints", async () => {
    for (const path of ["/api/goals", "/api/tasks", "/api/reports", "/api/balance"]) {
      const r = respond();
      await route(request(path), r.res);
      expect(r.state.status).toBe(400);
    }
  });
});
