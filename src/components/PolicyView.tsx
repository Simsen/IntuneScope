import { useMemo, useState } from "react";
import type { IntuneObject, Inventory, PlatformKey, WorkloadId } from "../lib/model";
import { PLATFORM_LABEL } from "../lib/model";
import { isOrphaned } from "../lib/query";
import { AssignmentChip, Completeness, SelectionBar, Writable } from "./Shared";

type StateFilter = "any" | "unassigned" | "orphaned" | "filtered";
const PAGE = 200;

export function PolicyView({
  inv,
  onExport,
}: {
  inv: Inventory;
  onExport: (format: "xlsx" | "csv", objects: IntuneObject[], scope: string) => void;
}) {
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState<PlatformKey | "all">("all");
  const [workload, setWorkload] = useState<WorkloadId | "all">("all");
  const [state, setState] = useState<StateFilter>("any");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const platforms = useMemo(() => [...new Set(inv.objects.map((o) => o.platform))].sort(), [inv]);
  const workloads = useMemo(() => {
    const m = new Map<WorkloadId, string>();
    for (const s of inv.status) if (s.state === "done" && s.id !== "filters" && s.id !== "groups") m.set(s.id as WorkloadId, s.label);
    return [...m];
  }, [inv]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inv.objects.filter((o) => {
      if (platform !== "all" && o.platform !== platform) return false;
      if (workload !== "all" && o.workload !== workload) return false;
      if (state === "unassigned" && o.assignments.length) return false;
      if (state === "orphaned" && !o.assignments.some((a) => isOrphaned(a, inv))) return false;
      if (state === "filtered" && !o.assignments.some((a) => a.filterId)) return false;
      if (needle && !o.name.toLowerCase().includes(needle) && !o.id.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [inv, q, platform, workload, state]);

  const totalAssignments = useMemo(() => inv.objects.reduce((n, o) => n + o.assignments.length, 0), [inv]);
  const orphanCount = useMemo(
    () => inv.objects.reduce((n, o) => n + o.assignments.filter((a) => isOrphaned(a, inv)).length, 0),
    [inv],
  );

  const scope = [
    platform !== "all" ? PLATFORM_LABEL[platform] : "All platforms",
    workload !== "all" ? workloads.find(([id]) => id === workload)?.[1] : "all types",
    state !== "any" ? state : "",
    q ? `search "${q}"` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const visible = rows.slice(0, limit);
  const allVisibleSelected = visible.length > 0 && visible.every((o) => selected.has(o.key));
  const selectedObjects = inv.objects.filter((o) => selected.has(o.key));
  const selPlatforms = new Set(selectedObjects.map((o) => o.platform));

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="page-title">Policies &amp; assignments</h1>
          <p className="muted">
            {inv.objects.length.toLocaleString()} objects · {totalAssignments.toLocaleString()} assignments
            {orphanCount > 0 && (
              <>
                {" · "}
                <button className="link warn-link" onClick={() => setState("orphaned")}>
                  {orphanCount} orphaned assignment{orphanCount > 1 ? "s" : ""}
                </button>
              </>
            )}
          </p>
        </div>
        <div className="head-actions">
          <button className="btn compact" onClick={() => onExport("xlsx", rows, scope)}>
            Export .xlsx
          </button>
          <button className="btn secondary compact" onClick={() => onExport("csv", rows, scope)}>
            CSV
          </button>
        </div>
      </div>

      <div className="card toolbar">
        <label className="field grow">
          Search
          <input type="search" placeholder="Name or ID" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="field">
          Platform
          <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey | "all")}>
            <option value="all">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Type
          <select value={workload} onChange={(e) => setWorkload(e.target.value as WorkloadId | "all")}>
            <option value="all">All types</option>
            {workloads.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Assignment state
          <select value={state} onChange={(e) => setState(e.target.value as StateFilter)}>
            <option value="any">Any</option>
            <option value="unassigned">Unassigned only</option>
            <option value="orphaned">Has deleted group</option>
            <option value="filtered">Uses a filter</option>
          </select>
        </label>
      </div>

      <div className="card flush">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="check">
                  <input
                    type="checkbox"
                    aria-label="Select all visible"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        for (const o of visible) {
                          if (allVisibleSelected) n.delete(o.key);
                          else n.add(o.key);
                        }
                        return n;
                      })
                    }
                  />
                </th>
                <th>Name</th>
                <th>Platform</th>
                <th>Type</th>
                <th>Assignments · filter</th>
                <th>Edit</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.key} className={selected.has(o.key) ? "sel" : undefined}>
                  <td className="check">
                    <input type="checkbox" aria-label={`Select ${o.name}`} checked={selected.has(o.key)} onChange={() => toggle(o.key)} />
                  </td>
                  <td className="strong">{o.name}</td>
                  <td className="muted nowrap">{PLATFORM_LABEL[o.platform]}</td>
                  <td className="muted">{o.typeLabel}</td>
                  <td>
                    <div className="chips">
                      {o.assignments.length ? (
                        o.assignments.map((a, i) => <AssignmentChip key={i} a={a} inv={inv} />)
                      ) : (
                        <span className="chip none">Unassigned</span>
                      )}
                    </div>
                  </td>
                  <td className="nowrap">
                    <Writable yes={o.writable} />
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={6} className="empty">
                    No objects match these filters in the workloads you can see.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <div className="more">
            <button className="btn secondary compact" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, rows.length - limit)} more ({rows.length - limit} hidden)
            </button>
          </div>
        )}
        <Completeness inv={inv} extra={<span>Showing {Math.min(limit, rows.length).toLocaleString()} of {rows.length.toLocaleString()}</span>} />
      </div>

      <SelectionBar
        count={selected.size}
        note={selPlatforms.size > 1 ? `${selPlatforms.size} platforms` : selPlatforms.size === 1 ? PLATFORM_LABEL[[...selPlatforms][0]] : undefined}
        onExport={() => onExport("xlsx", selectedObjects, `Selection (${selectedObjects.length} objects)`)}
      />
    </>
  );
}
