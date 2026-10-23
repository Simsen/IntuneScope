import { useMemo, useState } from "react";
import type { IntuneObject, Inventory } from "../lib/model";
import { PLATFORM_LABEL } from "../lib/model";
import { referencesToFilter, targetName, usageCounts } from "../lib/query";
import { Stat } from "./GroupLookup";
import { Completeness, SelectionBar, Writable } from "./Shared";

export function FilterLookup({
  inv,
  onExport,
}: {
  inv: Inventory;
  onExport: (format: "xlsx" | "csv", objects: IntuneObject[], scope: string) => void;
}) {
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const counts = useMemo(() => usageCounts(inv).filters, [inv]);
  const filtersLoaded = inv.status.find((s) => s.id === "filters")?.state === "done";

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...inv.filters.values()]
      .filter((f) => !needle || f.name.toLowerCase().includes(needle) || f.platformLabel.toLowerCase().includes(needle))
      .sort((a, b) => a.platformLabel.localeCompare(b.platformLabel) || a.name.localeCompare(b.name));
  }, [inv, q]);

  const picked = pickedId ? inv.filters.get(pickedId) : undefined;
  const refs = useMemo(() => (pickedId ? referencesToFilter(inv, pickedId) : []), [inv, pickedId]);
  const incl = refs.filter((r) => r.assignment.filterMode === "include").length;
  const selectedObjects = refs.filter((r) => selected.has(r.object.key)).map((r) => r.object);

  return (
    <div className="lookup">
      <aside className="card flush lookup-list">
        <div className="lookup-search">
          <label className="field">
            Assignment filters ({inv.filters.size})
            <input type="search" placeholder="Search filters" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {!filtersLoaded && <p className="warn-inline small pad">Assignment filters could not be loaded.</p>}
        <ul className="pick-list">
          {list.map((f) => {
            const n = counts.get(f.id) ?? 0;
            return (
              <li key={f.id}>
                <button
                  className={pickedId === f.id ? "pick active" : "pick"}
                  onClick={() => {
                    setPickedId(f.id);
                    setSelected(new Set());
                  }}
                >
                  <span className="pick-text">
                    <span className="pick-name">{f.name}</span>
                    <span className="muted small">{f.platformLabel}</span>
                  </span>
                  <span className={n ? "count" : "count warn"}>{n ? n : "No references found"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="lookup-main">
        {!picked ? (
          <div className="card">
            <h2>Pick an assignment filter</h2>
            <p className="muted">See every policy, app and script using it — and whether in include or exclude mode.</p>
          </div>
        ) : (
          <>
            <div className="card summary">
              <div>
                <h1 className="page-title">{picked.name}</h1>
                <p className="muted small">
                  {picked.platformLabel} · {picked.managementType === "apps" ? "Managed apps" : "Managed devices"} ·{" "}
                  <span className="tenant-id">{picked.id}</span>
                </p>
              </div>
              <div className="stats">
                <Stat n={refs.length} label="references" />
                <Stat n={incl} label="include mode" cls="accent" />
                <Stat n={refs.length - incl} label="exclude mode" cls="err" />
              </div>
              {picked.rule && <pre className="rule">{picked.rule}</pre>}
            </div>

            <div className="card flush">
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th className="check" />
                      <th>Type</th>
                      <th>Name</th>
                      <th>Platform</th>
                      <th>Target</th>
                      <th>Filter mode</th>
                      <th>Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refs.map((r, i) => (
                      <tr key={`${r.object.key}-${i}`} className={selected.has(r.object.key) ? "sel" : undefined}>
                        <td className="check">
                          <input
                            type="checkbox"
                            aria-label={`Select ${r.object.name}`}
                            checked={selected.has(r.object.key)}
                            onChange={() =>
                              setSelected((s) => {
                                const n = new Set(s);
                                if (n.has(r.object.key)) n.delete(r.object.key);
                                else n.add(r.object.key);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td className="muted nowrap">{r.object.typeLabel}</td>
                        <td className="strong">{r.object.name}</td>
                        <td className="muted nowrap">{PLATFORM_LABEL[r.object.platform]}</td>
                        <td className="nowrap">
                          {r.assignment.intent === "exclude" ? "− " : "+ "}
                          {targetName(r.assignment, inv)}
                        </td>
                        <td>
                          <span className={`pill ${r.assignment.filterMode === "exclude" ? "exc" : "inc"}`}>
                            {r.assignment.filterMode === "exclude" ? "Exclude" : "Include"}
                          </span>
                        </td>
                        <td className="nowrap">
                          <Writable yes={r.object.writable} />
                        </td>
                      </tr>
                    ))}
                    {!refs.length && (
                      <tr>
                        <td colSpan={7} className="empty">
                          No references found in the workloads you can see.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <Completeness inv={inv} />
            </div>

            <div className="head-actions">
              <button
                className="btn compact"
                disabled={!refs.length}
                onClick={() => onExport("xlsx", [...new Map(refs.map((r) => [r.object.key, r.object])).values()], `Filter: ${picked.name}`)}
              >
                Export .xlsx
              </button>
            </div>

            <SelectionBar
              count={selected.size}
              onExport={() => onExport("xlsx", selectedObjects, `Filter ${picked.name} — selection`)}
              objects={selectedObjects}
              hint={{ filterId: picked.id }}
            />
          </>
        )}
      </section>
    </div>
  );
}
