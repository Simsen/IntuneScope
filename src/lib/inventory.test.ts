import { describe, expect, it, vi } from "vitest";

// Fake Graph: apps/scripts endpoints return 403, everything else is empty.
vi.mock("./graph", () => {
  class GraphError extends Error {
    constructor(public status: number) {
      super(`HTTP ${status}`);
    }
  }
  const forbidden = /mobileApps|deviceManagementScripts|deviceShellScripts|deviceHealthScripts/;
  return {
    GraphError,
    getAll: vi.fn(async (path: string) => {
      if (forbidden.test(path)) throw new GraphError(403);
      return [];
    }),
    batchGet: vi.fn(async () => new Map()),
    graph: vi.fn(),
    describeError: (e: { status?: number }) => `${e.status} — no read access`,
  };
});
vi.mock("../config", () => ({ GRAPH_V1: "https://graph.microsoft.com/v1.0" }));

import { loadInventory } from "./inventory";

const scripts = ["apps", "platformScripts", "shellScripts", "remediations"] as const;

describe("loadInventory — optional workloads", () => {
  it("marks a 403 on an optional workload as skipped with the reason, not as an error", async () => {
    const inv = await loadInventory(() => {}, { optional: [...scripts], optionalReason: "needs re-approval" });
    for (const id of scripts) expect(inv.status.find((s) => s.id === id)).toMatchObject({ state: "skipped", detail: "needs re-approval" });
    expect(inv.status.find((s) => s.id === "configurationPolicies")?.state).toBe("done");
  });

  it("still reports a 403 as an error when the workload is not optional (Explorer)", async () => {
    const inv = await loadInventory(() => {});
    for (const id of scripts) expect(inv.status.find((s) => s.id === id)?.state).toBe("error");
  });
});
