/**
 * Editor write engine — pure functions, no Graph calls.
 *
 * Works on RAW Graph assignment targets so anything the Editor does not touch (unknown target types,
 * extra properties) is passed through verbatim. Rules verified on a live tenant 2026-10-23 (concept §7.7):
 *  - /assign replaces the whole collection; an empty collection clears it.
 *  - Graph accepts filters on exclusions for some workloads and never validates filter platform,
 *    so both rules are enforced here.
 */
import type { IntuneObject, PlatformKey } from "./model";

export type RawTarget = {
  "@odata.type"?: string;
  groupId?: string;
  deviceAndAppManagementAssignmentFilterId?: string | null;
  deviceAndAppManagementAssignmentFilterType?: string | null;
  [k: string]: unknown;
};
export type RawAssignment = { target?: RawTarget; source?: string; [k: string]: unknown };

export type TargetRef = { kind: "group"; groupId: string } | { kind: "allUsers" } | { kind: "allDevices" };
export type FilterRef = { id: string; mode: "include" | "exclude" };

export type Operation =
  | { op: "add"; target: TargetRef; intent: "include" | "exclude"; filter: FilterRef | null }
  | { op: "replace"; from: TargetRef; to: TargetRef }
  | { op: "remove"; target: TargetRef }
  | { op: "changeFilter"; match: { by: "target"; target: TargetRef } | { by: "filter"; filterId: string }; filter: FilterRef | null };

export type PlanStatus = "change" | "noChange" | "invalid";
export interface PolicyPlan {
  status: PlanStatus;
  reason?: string;
  before: RawTarget[];
  after: RawTarget[];
}

const T = {
  include: "#microsoft.graph.groupAssignmentTarget",
  exclude: "#microsoft.graph.exclusionGroupAssignmentTarget",
  allUsers: "#microsoft.graph.allLicensedUsersAssignmentTarget",
  allDevices: "#microsoft.graph.allDevicesAssignmentTarget",
} as const;

const ZERO = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

/** Workloads the Editor writes (same /assign contract, verified). */
export const WRITE_COLLECTION: Partial<Record<IntuneObject["workload"], string>> = {
  configurationPolicies: "configurationPolicies",
  deviceConfigurations: "deviceConfigurations",
  compliance: "deviceCompliancePolicies",
};

/**
 * Assignment-filter platforms that are valid for a policy platform. Empty = filter changes not offered.
 * Graph does NOT validate this pairing, so a wrong entry here silently produces a filter that never applies.
 */
export const FILTER_PLATFORMS: Record<PlatformKey, string[]> = {
  windows: ["windows10AndLater"],
  macOS: ["macOS"],
  ios: ["iOS"],
  androidEnterprise: ["androidForWork"],
  androidWorkProfile: ["androidWorkProfile", "androidForWork"],
  aosp: ["androidAOSP"],
  androidDeviceAdmin: ["android"],
  linux: [],
  multi: [],
  unknown: [],
};

export function isExclusion(t: RawTarget): boolean {
  return t["@odata.type"] === T.exclude;
}

export function filterOf(t: RawTarget): FilterRef | null {
  const id = t.deviceAndAppManagementAssignmentFilterId;
  const mode = t.deviceAndAppManagementAssignmentFilterType;
  if (!id || ZERO.test(id) || (mode !== "include" && mode !== "exclude")) return null;
  return { id, mode };
}

/** Does this raw target point at the given target (ignoring include/exclude)? */
export function matchesTarget(t: RawTarget, ref: TargetRef): boolean {
  const type = t["@odata.type"];
  switch (ref.kind) {
    case "allUsers":
      return type === T.allUsers;
    case "allDevices":
      return type === T.allDevices;
    case "group":
      return (type === T.include || type === T.exclude) && t.groupId?.toLowerCase() === ref.groupId.toLowerCase();
  }
}

export function sameTarget(a: TargetRef, b: TargetRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== "group" || a.groupId.toLowerCase() === (b as { groupId: string }).groupId.toLowerCase();
}

export function buildTarget(ref: TargetRef, intent: "include" | "exclude", filter: FilterRef | null): RawTarget {
  const type = ref.kind === "allUsers" ? T.allUsers : ref.kind === "allDevices" ? T.allDevices : intent === "exclude" ? T.exclude : T.include;
  return {
    "@odata.type": type,
    ...(ref.kind === "group" ? { groupId: ref.groupId } : {}),
    deviceAndAppManagementAssignmentFilterId: filter && intent === "include" ? filter.id : null,
    deviceAndAppManagementAssignmentFilterType: filter && intent === "include" ? filter.mode : "none",
  };
}

function withFilter(t: RawTarget, filter: FilterRef | null): RawTarget {
  return {
    ...t,
    deviceAndAppManagementAssignmentFilterId: filter ? filter.id : null,
    deviceAndAppManagementAssignmentFilterType: filter ? filter.mode : "none",
  };
}

/** Order-independent signature of an assignment set — the compare-and-skip key. */
export function signature(targets: RawTarget[]): string {
  return JSON.stringify(
    targets
      .map((t) => {
        const f = filterOf(t);
        return [t["@odata.type"] ?? "", (t.groupId ?? "").toLowerCase(), f?.id.toLowerCase() ?? "", f?.mode ?? ""].join("|");
      })
      .sort(),
  );
}

/** Raw /assignments response → targets, or a reason the policy must not be rewritten. */
export function extractTargets(assignments: RawAssignment[]): { targets: RawTarget[]; blocked?: string } {
  const fromSet = assignments.find((a) => a.source && a.source !== "direct");
  if (fromSet) return { targets: assignments.map((a) => a.target ?? {}), blocked: "Has assignments from a policy set — change them in Intune." };
  return { targets: assignments.map((a) => a.target ?? {}) };
}

/** Request body for POST …/{id}/assign (identical for all three write collections). */
export function assignBody(targets: RawTarget[]): { assignments: { target: RawTarget }[] } {
  return { assignments: targets.map((target) => ({ target })) };
}

/** Apply one operation to one policy's current targets. Never throws. */
export function planOperation(before: RawTarget[], op: Operation): PolicyPlan {
  const res = (status: PlanStatus, after: RawTarget[], reason?: string): PolicyPlan => ({ status, before, after, reason });
  const unchanged = (reason: string) => res("noChange", before, reason);
  const invalid = (reason: string) => res("invalid", before, reason);

  switch (op.op) {
    case "add": {
      if (op.intent === "exclude" && op.target.kind !== "group") return invalid("Only groups can be excluded.");
      if (op.intent === "exclude" && op.filter) return invalid("Filters can't be used on exclusions.");
      const existing = before.filter((t) => matchesTarget(t, op.target));
      if (existing.length) {
        const same = existing.some((t) => isExclusion(t) === (op.intent === "exclude"));
        if (!same) return invalid(`Already assigned as ${op.intent === "exclude" ? "include" : "exclude"} — remove it first.`);
        const f = filterOf(existing[0]);
        const wantF = op.intent === "include" ? op.filter : null;
        if ((f?.id ?? "") === (wantF?.id ?? "") && (f?.mode ?? "") === (wantF?.mode ?? "")) return unchanged("Already assigned exactly like this.");
        return invalid("Already assigned with a different filter — use Change filter.");
      }
      return res("change", [...before, buildTarget(op.target, op.intent, op.filter)]);
    }

    case "replace": {
      if (sameTarget(op.from, op.to)) return unchanged("From and to are the same target.");
      const hits = before.filter((t) => matchesTarget(t, op.from));
      if (!hits.length) return unchanged("From-target is not assigned here.");
      if (before.some((t) => matchesTarget(t, op.to))) return invalid("To-target is already assigned — remove one of them instead.");
      if (op.to.kind !== "group" && hits.some(isExclusion)) return invalid("An exclusion can only be moved to another group.");
      const after = before.map((t) => {
        if (!matchesTarget(t, op.from)) return t;
        const f = filterOf(t);
        return buildTarget(op.to, isExclusion(t) ? "exclude" : "include", f);
      });
      return res("change", after);
    }

    case "remove": {
      const after = before.filter((t) => !matchesTarget(t, op.target));
      return after.length === before.length ? unchanged("Target is not assigned here.") : res("change", after);
    }

    case "changeFilter": {
      const hit = (t: RawTarget) =>
        op.match.by === "target" ? matchesTarget(t, op.match.target) : filterOf(t)?.id.toLowerCase() === op.match.filterId.toLowerCase();
      const hits = before.filter(hit);
      if (!hits.length) return unchanged(op.match.by === "target" ? "Target is not assigned here." : "Filter is not used here.");
      if (hits.every(isExclusion)) return invalid("Only exclusions match — filters can't be used on exclusions.");
      let changed = false;
      const after = before.map((t) => {
        if (!hit(t) || isExclusion(t)) return t;
        const f = filterOf(t);
        if ((f?.id.toLowerCase() ?? "") === (op.filter?.id.toLowerCase() ?? "") && (f?.mode ?? "") === (op.filter?.mode ?? "")) return t;
        changed = true;
        return withFilter(t, op.filter);
      });
      return changed ? res("change", after) : unchanged("Filter is already set like this.");
    }
  }
}

/** Split a selection into write batches: one per policy platform. Read-only objects are returned separately. */
export function splitByPlatform(objects: IntuneObject[]): { batches: Map<PlatformKey, IntuneObject[]>; readOnly: IntuneObject[] } {
  const batches = new Map<PlatformKey, IntuneObject[]>();
  const readOnly: IntuneObject[] = [];
  for (const o of objects) {
    if (!o.writable || !WRITE_COLLECTION[o.workload]) {
      readOnly.push(o);
      continue;
    }
    batches.set(o.platform, [...(batches.get(o.platform) ?? []), o]);
  }
  return { batches, readOnly };
}

/** Is this operation's filter allowed for the batch platform? */
export function filterAllowed(op: Operation, platform: PlatformKey, filterPlatform: (id: string) => string | undefined): string | null {
  const f = op.op === "add" || op.op === "changeFilter" ? op.filter : null;
  if (!f) return null;
  const p = filterPlatform(f.id);
  if (!p || !FILTER_PLATFORMS[platform].includes(p)) return "The filter's platform doesn't match these policies.";
  return null;
}
