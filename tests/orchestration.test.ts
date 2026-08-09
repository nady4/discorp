import { describe, expect, it } from "vitest";
import { routeTask } from "../src/orchestration/router.js";
import { extractJson } from "../src/utils/json.js";

describe("routeTask", () => {
  const agents = ["ceo", "cto", "pm", "developer", "qa", "research", "security", "marketing", "finance", "community"];

  it("routes implementation work to the developer", () => {
    expect(routeTask({ title: "Implement the billing API", description: "Build the endpoint and fix bugs", activeAgentIds: agents })).toBe("developer");
  });

  it("routes security work to the security agent", () => {
    expect(routeTask({ title: "Audit secrets", description: "Check for vulnerabilities and compliance issues", activeAgentIds: agents })).toBe("security");
  });

  it("routes tests to QA", () => {
    expect(routeTask({ title: "Write tests", description: "Verify quality and coverage of the new feature", activeAgentIds: agents })).toBe("qa");
  });

  it("falls back to PM when nothing matches", () => {
    expect(routeTask({ title: "xylophone", description: "zzz", activeAgentIds: agents })).toBe("pm");
  });

  it("never returns an agent outside the active set", () => {
    const result = routeTask({ title: "Implement billing", description: "build api", activeAgentIds: ["ceo", "pm"] });
    expect(["ceo", "pm"]).toContain(result);
  });
});

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown code fences", () => {
    expect(extractJson<{ tasks: string[] }>('```json\n{"tasks":["a"]}\n```')).toEqual({ tasks: ["a"] });
  });

  it("extracts JSON embedded in prose", () => {
    const text = 'Here is the plan:\n{"tasks":[{"title":"x"}]}\nThat is all.';
    expect(extractJson<{ tasks: Array<{ title: string }> }>(text)?.tasks).toEqual([{ title: "x" }]);
  });

  it("returns null when no JSON exists", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});
