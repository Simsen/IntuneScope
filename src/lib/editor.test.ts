import { describe, expect, it } from "vitest";
import {
  assignBody,
  buildTarget,
  extractTargets,
  filterAllowed,
  planOperation,
  signature,
  splitByPlatform,
  type RawTarget,
} from "./editor";
import type { IntuneObject } from "./model";

const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";
const F1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const F2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const inc = (g: string, f?: { id: string; mode: "include" | "exclude" }): RawTarget => buildTarget({ kind: "group", groupId: g }, "include", f ?? null);
const exc = (g: string): RawTarget => buildTarget({ kind: "group", groupId: g }, "exclude", null);
const allDevices = (f?: { id: string; mode: "include" | "exclude" }) => buildTarget({ kind: "allDevices" }, "include", f ?? null);
/** Something the Editor doesn't understand — must survive any rewrite untouched. */
const weird: RawTarget = { "@odata.type": "#microsoft.graph.configurationManagerCollectionAssignmentTarget", collectionId: "SMS00001" };

describe("buildTarget", () => {
  it("never puts a filter on an exclusion", () => {
    const t = buildTarget({ kind: "group", groupId: G1 }, "exclude", { id: F1, mode: "include" });
    expect(t.deviceAndAppManagementAssignmentFilterType).toBe("none");
    expect(t.deviceAndAppManagementAssignmentFilterId).toBeNull();
  });
});

describe("add", () => {
  it("appends and keeps unrelated (incl. unknown) targets verbatim", () => {
    const p = planOperation([weird, inc(G1)], { op: "add", target: { kind: "group", groupId: G2 }, intent: "include", filter: { id: F1, mode: "include" } });
    expect(p.status).toBe("change");
    expect(p.after).toHaveLength(3);
    expect(p.after[0]).toBe(weird);
    expect(p.after[2]).toMatchObject({ groupId: G2, deviceAndAppManagementAssignmentFilterId: F1 });
  });
  it("rejects filter on exclusion and excluding All Devices", () => {
    expect(planOperation([], { op: "add", target: { kind: "group", groupId: G1 }, intent: "exclude", filter: { id: F1, mode: "include" } }).status).toBe("invalid");
    expect(planOperation([], { op: "add", target: { kind: "allDevices" }, intent: "exclude", filter: null }).status).toBe("invalid");
  });
  it("is a no-op when identical, invalid when it conflicts", () => {
    expect(planOperation([inc(G1)], { op: "add", target: { kind: "group", groupId: G1 }, intent: "include", filter: null }).status).toBe("noChange");
    expect(planOperation([exc(G1)], { op: "add", target: { kind: "group", groupId: G1 }, intent: "include", filter: null }).status).toBe("invalid");
    expect(planOperation([inc(G1, { id: F1, mode: "include" })], { op: "add", target: { kind: "group", groupId: G1 }, intent: "include", filter: null }).status).toBe("invalid");
  });
});

describe("replace", () => {
  it("moves target, keeps intent and filter", () => {
    const p = planOperation([inc(G1, { id: F1, mode: "exclude" }), weird], { op: "replace", from: { kind: "group", groupId: G1 }, to: { kind: "group", groupId: G2 } });
    expect(p.status).toBe("change");
    expect(p.after[0]).toMatchObject({ groupId: G2, deviceAndAppManagementAssignmentFilterId: F1, deviceAndAppManagementAssignmentFilterType: "exclude" });
    expect(p.after[1]).toBe(weird);
  });
  it("keeps an exclusion an exclusion; can't move it to All Devices", () => {
    expect(planOperation([exc(G1)], { op: "replace", from: { kind: "group", groupId: G1 }, to: { kind: "group", groupId: G2 } }).after[0]["@odata.type"]).toContain("exclusion");
    expect(planOperation([exc(G1)], { op: "replace", from: { kind: "group", groupId: G1 }, to: { kind: "allDevices" } }).status).toBe("invalid");
  });
  it("won't create a duplicate", () => {
    expect(planOperation([inc(G1), inc(G2)], { op: "replace", from: { kind: "group", groupId: G1 }, to: { kind: "group", groupId: G2 } }).status).toBe("invalid");
  });
  it("is a no-op when from isn't assigned", () => {
    expect(planOperation([inc(G2)], { op: "replace", from: { kind: "group", groupId: G1 }, to: { kind: "allDevices" } }).status).toBe("noChange");
  });
});

describe("remove", () => {
  it("removes include and exclude of that group, nothing else", () => {
    const p = planOperation([inc(G1), allDevices(), weird], { op: "remove", target: { kind: "group", groupId: G1 } });
    expect(p.after).toEqual([allDevices(), weird]);
  });
  it("can remove the last assignment (empty set is valid)", () => {
    const p = planOperation([inc(G1)], { op: "remove", target: { kind: "group", groupId: G1 } });
    expect(p.status).toBe("change");
    expect(assignBody(p.after)).toEqual({ assignments: [] });
  });
  it("matches group IDs case-insensitively", () => {
    expect(planOperation([inc(G1.toUpperCase())], { op: "remove", target: { kind: "group", groupId: G1 } }).status).toBe("change");
  });
});

describe("changeFilter", () => {
  it("sets, switches and removes filters on includes only", () => {
    const before = [allDevices(), exc(G1)];
    const set = planOperation(before, { op: "changeFilter", match: { by: "target", target: { kind: "allDevices" } }, filter: { id: F1, mode: "include" } });
    expect(set.after[0]).toMatchObject({ deviceAndAppManagementAssignmentFilterId: F1, deviceAndAppManagementAssignmentFilterType: "include" });
    expect(set.after[1]).toEqual(exc(G1));
    const off = planOperation(set.after, { op: "changeFilter", match: { by: "filter", filterId: F1 }, filter: null });
    expect(off.after[0]).toMatchObject({ deviceAndAppManagementAssignmentFilterId: null, deviceAndAppManagementAssignmentFilterType: "none" });
  });
  it("replaces a filter everywhere it is used", () => {
    const p = planOperation([inc(G1, { id: F1, mode: "include" }), inc(G2, { id: F1, mode: "include" })], { op: "changeFilter", match: { by: "filter", filterId: F1 }, filter: { id: F2, mode: "exclude" } });
    expect(p.after.every((t) => t.deviceAndAppManagementAssignmentFilterId === F2)).toBe(true);
  });
  it("refuses to put a filter on an exclusion", () => {
    expect(planOperation([exc(G1)], { op: "changeFilter", match: { by: "target", target: { kind: "group", groupId: G1 } }, filter: { id: F1, mode: "include" } }).status).toBe("invalid");
  });
  it("no-op when already like that", () => {
    expect(planOperation([inc(G1, { id: F1, mode: "include" })], { op: "changeFilter", match: { by: "target", target: { kind: "group", groupId: G1 } }, filter: { id: F1, mode: "include" } }).status).toBe("noChange");
  });
});

describe("signature (compare-and-skip)", () => {
  it("ignores order, extra props and zero-GUID filters", () => {
    const a = [inc(G1), { ...allDevices(), extra: 1, deviceAndAppManagementAssignmentFilterId: "00000000-0000-0000-0000-000000000000" }];
    const b = [allDevices(), inc(G1)];
    expect(signature(a)).toBe(signature(b));
  });
  it("detects a changed filter mode", () => {
    expect(signature([inc(G1, { id: F1, mode: "include" })])).not.toBe(signature([inc(G1, { id: F1, mode: "exclude" })]));
  });
});

describe("guards", () => {
  it("blocks policies with policy-set assignments", () => {
    expect(extractTargets([{ target: inc(G1), source: "policySets" }]).blocked).toBeTruthy();
    expect(extractTargets([{ target: inc(G1), source: "direct" }]).blocked).toBeUndefined();
  });
  it("splits a selection by platform and drops read-only", () => {
    const o = (key: string, platform: IntuneObject["platform"], workload: IntuneObject["workload"], writable = true): IntuneObject => ({
      key, id: key, name: key, workload, typeLabel: "", platform, writable, assignments: [],
    });
    const { batches, readOnly } = splitByPlatform([o("a", "windows", "configurationPolicies"), o("b", "macOS", "compliance"), o("c", "windows", "apps", false), o("d", "windows", "deviceConfigurations")]);
    expect(batches.get("windows")?.map((x) => x.key)).toEqual(["a", "d"]);
    expect(batches.get("macOS")).toHaveLength(1);
    expect(readOnly.map((x) => x.key)).toEqual(["c"]);
  });
  it("rejects a filter from another platform", () => {
    const op = { op: "add" as const, target: { kind: "allDevices" as const }, intent: "include" as const, filter: { id: F1, mode: "include" as const } };
    expect(filterAllowed(op, "windows", () => "windows10AndLater")).toBeNull();
    expect(filterAllowed(op, "androidEnterprise", () => "windows10AndLater")).toBeTruthy();
    expect(filterAllowed(op, "multi", () => "windows10AndLater")).toBeTruthy();
  });
});
