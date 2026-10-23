import { describe, expect, it, vi } from "vitest";

// The Graph client pulls in MSAL/window; the executor is tested through an injected fake IO instead.
vi.mock("./graph", () => ({
  batchGet: vi.fn(),
  graph: vi.fn(),
  GraphError: class GraphError extends Error {
    status = 0;
  },
}));
import { buildTarget, type RawAssignment, type RawTarget } from "./editor";
import { applyChanges, backupJson, buildPreview, type EditorIO } from "./editorRun";
import type { IntuneObject } from "./model";

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
const obj = (id: string): IntuneObject => ({ key: `configurationPolicies:${id}`, id, name: id, workload: "configurationPolicies", typeLabel: "", platform: "windows", writable: true, assignments: [] });
const wrap = (ts: RawTarget[]): RawAssignment[] => ts.map((target) => ({ id: "x", source: "direct", target }));

/** In-memory tenant. `drift` lets a test change a policy between preview and apply. */
function fakeTenant(initial: Record<string, RawTarget[]>, opts: { failWrite?: string; mangle?: string } = {}) {
  const store = new Map(Object.entries(initial));
  const writes: string[] = [];
  const io: EditorIO = {
    async readMany(objects) {
      return objects.map((o) => wrap(store.get(o.id) ?? []));
    },
    async read(o) {
      return wrap(store.get(o.id) ?? []);
    },
    async write(o, targets) {
      if (o.id === opts.failWrite) throw new Error("boom");
      writes.push(o.id);
      store.set(o.id, o.id === opts.mangle ? [] : targets);
    },
  };
  return { io, store, writes };
}

const replaceOp = { op: "replace" as const, from: { kind: "group" as const, groupId: G1 }, to: { kind: "group" as const, groupId: G2 } };

describe("applyChanges", () => {
  it("writes, verifies and skips no-change rows without calling Graph", async () => {
    const t = fakeTenant({ a: [buildTarget({ kind: "group", groupId: G1 }, "include", null)], b: [] });
    const rows = await buildPreview([obj("a"), obj("b")], replaceOp, t.io);
    expect(rows.map((r) => r.plan.status)).toEqual(["change", "noChange"]);
    const out = await applyChanges(rows, t.io, () => {});
    expect(out.map((r) => r.status)).toEqual(["ok", "skipped"]);
    expect(t.writes).toEqual(["a"]);
    expect(t.store.get("a")?.[0].groupId).toBe(G2);
  });

  it("does not write when the policy changed after the preview (compare-and-skip)", async () => {
    const t = fakeTenant({ a: [buildTarget({ kind: "group", groupId: G1 }, "include", null)] });
    const rows = await buildPreview([obj("a")], replaceOp, t.io);
    t.store.set("a", [...t.store.get("a")!, buildTarget({ kind: "allDevices" }, "include", null)]); // someone edits in the portal
    const out = await applyChanges(rows, t.io, () => {});
    expect(out[0].status).toBe("changed");
    expect(t.writes).toEqual([]);
  });

  it("reports verification failure and write errors per policy, and keeps going", async () => {
    const t = fakeTenant(
      { a: [buildTarget({ kind: "group", groupId: G1 }, "include", null)], b: [buildTarget({ kind: "group", groupId: G1 }, "include", null)], c: [buildTarget({ kind: "group", groupId: G1 }, "include", null)] },
      { failWrite: "a", mangle: "b" },
    );
    const rows = await buildPreview([obj("a"), obj("b"), obj("c")], replaceOp, t.io);
    const out = await applyChanges(rows, t.io, () => {});
    expect(out.map((r) => r.status)).toEqual(["failed", "verifyFailed", "ok"]);
  });

  it("can be stopped between policies", async () => {
    const t = fakeTenant({ a: [buildTarget({ kind: "group", groupId: G1 }, "include", null)], b: [buildTarget({ kind: "group", groupId: G1 }, "include", null)] });
    const rows = await buildPreview([obj("a"), obj("b")], replaceOp, t.io);
    let n = 0;
    const out = await applyChanges(rows, t.io, () => {}, () => n++ > 0);
    expect(out.map((r) => r.status)).toEqual(["ok", "skipped"]);
  });

  it("blocks policies with policy-set assignments in the preview", async () => {
    const io: EditorIO = {
      async readMany() {
        return [[{ source: "policySets", target: buildTarget({ kind: "group", groupId: G1 }, "include", null) }]];
      },
      async read() {
        return [];
      },
      async write() {
        throw new Error("must not write");
      },
    };
    const rows = await buildPreview([obj("a")], replaceOp, io);
    expect(rows[0].plan.status).toBe("invalid");
  });

  it("backup contains the raw assignments and a ready-to-POST restore body", async () => {
    const t = fakeTenant({ a: [buildTarget({ kind: "group", groupId: G1 }, "include", null)] });
    const rows = await buildPreview([obj("a")], replaceOp, t.io);
    const b = JSON.parse(backupJson(rows, { tenant: "t" }));
    expect(b.policies[0].assignments[0].target.groupId).toBe(G1);
    expect(b.policies[0].restore.path).toBe("/beta/deviceManagement/configurationPolicies/a/assign");
    expect(b.policies[0].restore.body.assignments[0].target.groupId).toBe(G1);
  });
});
