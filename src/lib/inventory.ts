import { GRAPH_V1 } from "../config";
import { batchGet, describeError, getAll, graph, GraphError } from "./graph";
import type { AssignmentFilter, GroupInfo, IntuneObject, Inventory, PlatformKey, WorkloadId, WorkloadStatus } from "./model";
import {
  appTypeLabel,
  deviceConfigTypeLabel,
  filterPlatformLabel,
  normalizeAssignment,
  platformFromODataType,
  platformFromSettingsCatalog,
  settingsCatalogTypeLabel,
} from "./normalize";

/**
 * Read adapters. Each one lists a collection and its assignments.
 * Strategy per collection: try `$select` + `$expand=assignments`; if Graph rejects the query (400),
 * fall back to a plain list and fetch `/{id}/assignments` through $batch.
 */

type Raw = Record<string, any>;

interface Adapter {
  id: WorkloadId;
  label: string;
  path: string;
  select: string;
  writable: boolean;
  map: (r: Raw) => Pick<IntuneObject, "name" | "typeLabel" | "platform">;
}

const byName = (r: Raw) => (r.displayName ?? r.name ?? "(unnamed)") as string;

export const ADAPTERS: Adapter[] = [
  {
    id: "configurationPolicies",
    label: "Settings catalog & endpoint security",
    path: "/deviceManagement/configurationPolicies",
    select: "id,name,platforms,technologies,templateReference",
    writable: true,
    map: (r) => ({
      name: byName(r),
      typeLabel: settingsCatalogTypeLabel(r.templateReference?.templateFamily),
      platform: platformFromSettingsCatalog(r.platforms),
    }),
  },
  {
    id: "deviceConfigurations",
    label: "Device configuration",
    path: "/deviceManagement/deviceConfigurations",
    select: "id,displayName",
    writable: true,
    map: (r) => ({ name: byName(r), typeLabel: deviceConfigTypeLabel(r["@odata.type"]), platform: platformFromODataType(r["@odata.type"]) }),
  },
  {
    id: "compliance",
    label: "Compliance",
    path: "/deviceManagement/deviceCompliancePolicies",
    select: "id,displayName",
    writable: true,
    map: (r) => ({ name: byName(r), typeLabel: "Compliance", platform: platformFromODataType(r["@odata.type"]) }),
  },
  {
    id: "apps",
    label: "Apps",
    path: "/deviceAppManagement/mobileApps",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: appTypeLabel(r["@odata.type"]), platform: platformFromODataType(r["@odata.type"]) }),
  },
  {
    id: "platformScripts",
    label: "Platform scripts (Windows)",
    path: "/deviceManagement/deviceManagementScripts",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Platform script", platform: "windows" }),
  },
  {
    id: "shellScripts",
    label: "Shell scripts (macOS)",
    path: "/deviceManagement/deviceShellScripts",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Shell script", platform: "macOS" }),
  },
  {
    id: "remediations",
    label: "Remediations",
    path: "/deviceManagement/deviceHealthScripts",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Remediation", platform: "windows" }),
  },
  {
    id: "featureUpdates",
    label: "Windows feature updates",
    path: "/deviceManagement/windowsFeatureUpdateProfiles",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Feature update", platform: "windows" }),
  },
  {
    id: "qualityUpdates",
    label: "Windows quality updates",
    path: "/deviceManagement/windowsQualityUpdateProfiles",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Quality update", platform: "windows" }),
  },
  {
    id: "driverUpdates",
    label: "Windows driver updates",
    path: "/deviceManagement/windowsDriverUpdateProfiles",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Driver update", platform: "windows" }),
  },
  {
    id: "admx",
    label: "Administrative templates (ADMX)",
    path: "/deviceManagement/groupPolicyConfigurations",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Administrative template", platform: "windows" }),
  },
  {
    id: "intents",
    label: "Endpoint security (legacy)",
    path: "/deviceManagement/intents",
    select: "id,displayName",
    writable: false,
    map: (r) => ({ name: byName(r), typeLabel: "Endpoint security (legacy)", platform: "unknown" as PlatformKey }),
  },
];

type Progress = (status: WorkloadStatus[]) => void;

async function loadAdapter(a: Adapter, onCount: (n: number, detail?: string) => void): Promise<IntuneObject[]> {
  let raws: Raw[];
  try {
    raws = await getAll<Raw>(`${a.path}?$select=${a.select}&$expand=assignments`, (n) => onCount(n));
  } catch (e) {
    if (!(e instanceof GraphError && e.status === 400)) throw e;
    raws = await getAll<Raw>(a.path, (n) => onCount(n));
  }

  // Some collections silently ignore $expand: fetch assignments per object through $batch.
  const missing = raws.filter((r) => !Array.isArray(r.assignments));
  if (missing.length) {
    onCount(raws.length, `reading assignments 0/${missing.length}`);
    const res = await batchGet<{ value: Raw[] }>(
      missing.map((r) => `${a.path}/${encodeURIComponent(r.id)}/assignments`),
      (done) => onCount(raws.length, `reading assignments ${done}/${missing.length}`),
    );
    missing.forEach((r, i) => {
      const v = res.get(i);
      r.assignments = v instanceof GraphError || !v ? [] : v.value;
      if (v instanceof GraphError) r.__assignmentError = v;
    });
  }
  return raws.map((r) => ({
    key: `${a.id}:${r.id}`,
    id: r.id,
    workload: a.id,
    writable: a.writable,
    ...a.map(r),
    assignments: (r.assignments as Raw[]).map(normalizeAssignment),
  }));
}

async function loadFilters(): Promise<Map<string, AssignmentFilter>> {
  const raws = await getAll<Raw>("/deviceManagement/assignmentFilters?$select=id,displayName,platform,rule,assignmentFilterManagementType");
  return new Map(
    raws.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.displayName,
        platform: r.platform,
        platformLabel: filterPlatformLabel(r.platform),
        rule: r.rule ?? "",
        managementType: r.assignmentFilterManagementType ?? "devices",
      },
    ]),
  );
}

/** Resolve group IDs → names, 15 IDs per `id in (...)` query, 20 queries per $batch. */
export async function resolveGroups(ids: string[], onDone?: (n: number) => void): Promise<Map<string, GroupInfo>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 15) chunks.push(ids.slice(i, i + 15));
  const paths = chunks.map((c) => `/groups?$select=id,displayName&$filter=${encodeURIComponent(`id in (${c.map((id) => `'${id}'`).join(",")})`)}`);
  const res = await batchGet<{ value: Raw[] }>(paths, (done) => onDone?.(Math.min(done * 15, ids.length)));
  const out = new Map<string, GroupInfo>();
  for (const [, v] of res) {
    if (v instanceof GraphError) throw v;
    for (const g of v.value) out.set(g.id, { id: g.id, name: g.displayName });
  }
  return out;
}

/** Search the whole tenant for groups by display name (for groups with zero references). */
export async function searchGroups(term: string): Promise<GroupInfo[]> {
  const q = term.replace(/"/g, "");
  const r = await graph<{ value: Raw[] }>(`${GRAPH_V1}/groups?$search="displayName:${encodeURIComponent(q)}"&$select=id,displayName&$top=25`, {
    headers: { ConsistencyLevel: "eventual" },
  });
  return r.value.map((g) => ({ id: g.id, name: g.displayName }));
}

/** Load the full inventory. Each workload fails independently; failures are reported, never hidden. */
export async function loadInventory(onProgress: Progress): Promise<Inventory> {
  const status: WorkloadStatus[] = [
    { id: "filters", label: "Assignment filters", state: "queued", count: 0 },
    ...ADAPTERS.map((a): WorkloadStatus => ({ id: a.id, label: a.label, state: "queued", count: 0 })),
    { id: "groups", label: "Entra groups (referenced)", state: "queued", count: 0 },
  ];
  const emit = () => onProgress(status.map((s) => ({ ...s })));
  const set = (id: WorkloadStatus["id"], patch: Partial<WorkloadStatus>) => {
    Object.assign(status.find((s) => s.id === id)!, patch);
    emit();
  };
  emit();

  let filters = new Map<string, AssignmentFilter>();
  set("filters", { state: "loading" });
  try {
    filters = await loadFilters();
    set("filters", { state: "done", count: filters.size, detail: `${filters.size} filters` });
  } catch (e) {
    set("filters", { state: "error", error: describeError(e) });
  }

  // Three workloads in parallel keeps us well under Intune's throttling limits.
  const objects: IntuneObject[] = [];
  const queue = [...ADAPTERS];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      const adapter = a;
      set(adapter.id, { state: "loading" });
      try {
        const objs = await loadAdapter(adapter, (n, detail) => set(adapter.id, { count: n, detail: detail ?? `${n} loaded` }));
        objects.push(...objs);
        set(adapter.id, { state: "done", count: objs.length, detail: `${objs.length} objects` });
      } catch (e) {
        set(adapter.id, { state: "error", error: describeError(e) });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  const ids = [...new Set(objects.flatMap((o) => o.assignments.filter((x) => x.groupId).map((x) => x.groupId!)))];
  let groups = new Map<string, GroupInfo>();
  const orphaned = new Set<string>();
  set("groups", { state: "loading", detail: `0/${ids.length}` });
  try {
    groups = await resolveGroups(ids, (n) => set("groups", { detail: `${n}/${ids.length}` }));
    for (const id of ids) if (!groups.has(id)) orphaned.add(id);
    set("groups", {
      state: "done",
      count: groups.size,
      detail: `${groups.size} resolved${orphaned.size ? ` · ${orphaned.size} not found` : ""}`,
    });
  } catch (e) {
    set("groups", { state: "error", error: describeError(e) });
  }

  objects.sort((x, y) => x.name.localeCompare(y.name));
  return { objects, filters, groups, orphanedGroupIds: orphaned, status: status.map((s) => ({ ...s })), loadedAt: new Date() };
}
