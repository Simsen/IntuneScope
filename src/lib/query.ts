import type { Assignment, IntuneObject, Inventory, WorkloadStatus } from "./model";
import { PLATFORM_LABEL } from "./model";

/** Derived, display-ready data shared by the views and the exporter. */

export function targetName(a: Assignment, inv: Pick<Inventory, "groups" | "orphanedGroupIds">): string {
  switch (a.targetKind) {
    case "allUsers":
      return "All Users";
    case "allDevices":
      return "All Devices";
    case "group": {
      const g = a.groupId ? inv.groups.get(a.groupId) : undefined;
      if (g) return g.name;
      if (a.groupId && inv.orphanedGroupIds.has(a.groupId)) return `Deleted group ${a.groupId.slice(0, 8)}…`;
      return a.groupId ?? "Unknown group";
    }
    default:
      return a.rawType ? a.rawType.replace(/AssignmentTarget$/, "") : "Other target";
  }
}

export function targetTypeLabel(a: Assignment): string {
  return a.targetKind === "group" ? "Group" : a.targetKind === "allUsers" ? "All Users" : a.targetKind === "allDevices" ? "All Devices" : "Other";
}

export const isOrphaned = (a: Assignment, inv: Pick<Inventory, "orphanedGroupIds">) =>
  !!a.groupId && inv.orphanedGroupIds.has(a.groupId);

export function filterLabel(a: Assignment, inv: Pick<Inventory, "filters">): string {
  if (!a.filterId) return "";
  const f = inv.filters.get(a.filterId);
  return f ? f.name : `Unknown filter ${a.filterId.slice(0, 8)}…`;
}

export interface Reference {
  object: IntuneObject;
  assignment: Assignment;
}

export function referencesToGroup(inv: Inventory, groupId: string): Reference[] {
  const out: Reference[] = [];
  for (const o of inv.objects) for (const a of o.assignments) if (a.groupId === groupId) out.push({ object: o, assignment: a });
  return out;
}

export function referencesToFilter(inv: Inventory, filterId: string): Reference[] {
  const out: Reference[] = [];
  for (const o of inv.objects) for (const a of o.assignments) if (a.filterId === filterId) out.push({ object: o, assignment: a });
  return out;
}

/** Count references per filter / per group, used for list badges. */
export function usageCounts(inv: Inventory): { filters: Map<string, number>; groups: Map<string, number> } {
  const filters = new Map<string, number>();
  const groups = new Map<string, number>();
  for (const o of inv.objects)
    for (const a of o.assignments) {
      if (a.filterId) filters.set(a.filterId, (filters.get(a.filterId) ?? 0) + 1);
      if (a.groupId) groups.set(a.groupId, (groups.get(a.groupId) ?? 0) + 1);
    }
  return { filters, groups };
}

export function completeness(status: WorkloadStatus[]): { searched: string[]; notSearched: string[] } {
  const searched: string[] = [];
  const notSearched: string[] = [];
  for (const s of status) {
    if (s.id === "filters" || s.id === "groups") continue;
    if (s.state === "done") searched.push(s.label);
    else notSearched.push(`${s.label}${s.error ? ` (${s.error})` : s.state === "skipped" && s.detail ? ` (${s.detail})` : ""}`);
  }
  return { searched, notSearched };
}

/** One row per assignment; unassigned objects get one row. Column order is the export contract. */
export const EXPORT_COLUMNS = [
  "Name",
  "Platform",
  "Type",
  "Writable (v1.0)",
  "Target",
  "Target type",
  "Relation",
  "App intent",
  "Filter",
  "Filter mode",
  "Orphaned group",
  "Object ID",
  "Target ID",
  "Filter ID",
] as const;

export function exportRows(objects: IntuneObject[], inv: Inventory): string[][] {
  const rows: string[][] = [];
  for (const o of objects) {
    const base = [o.name, PLATFORM_LABEL[o.platform], o.typeLabel, o.writable ? "Yes" : "No"];
    if (!o.assignments.length) {
      rows.push([...base, "(unassigned)", "", "", "", "", "", "", o.id, "", ""]);
      continue;
    }
    for (const a of o.assignments)
      rows.push([
        ...base,
        targetName(a, inv),
        targetTypeLabel(a),
        a.intent === "exclude" ? "Exclude" : "Include",
        a.appIntent ?? "",
        filterLabel(a, inv),
        a.filterMode ? (a.filterMode === "include" ? "Include" : "Exclude") : "",
        isOrphaned(a, inv) ? "Yes" : "No",
        o.id,
        a.groupId ?? "",
        a.filterId ?? "",
      ]);
  }
  return rows;
}
