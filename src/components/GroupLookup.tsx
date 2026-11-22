import { useEffect, useMemo, useState } from "react";
import { describeError } from "../lib/graph";
import type { GroupInfo, IntuneObject, Inventory } from "../lib/model";
import { PLATFORM_LABEL } from "../lib/model";
import { filterLabel, referencesToGroup, usageCounts } from "../lib/query";
import { Completeness, RelationPill, SelectionBar, Writable } from "./Shared";

export function GroupLookup({
  inv,
  onExport,
  search,
  parents: loadParents,
}: {
  inv: Inventory;
  onExport: (format: "xlsx" | "csv", objects: IntuneObject[], scope: string) => void;
  search: (term: string) => Promise<GroupInfo[]>;
  /** Every group the given group is nested in (any depth). */
  parents: (groupId: string) => Promise<GroupInfo[]>;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<GroupInfo | null>(null);
  const [parents, setParents] = useState<GroupInfo[] | null>(null);
  const [parentState, setParentState] = useState<"idle" | "loading" | "error">("idle");
  const [parentErr, setParentErr] = useState<string | null>(null);
  const [tenantHits, setTenantHits] = useState<GroupInfo[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const counts = useMemo(() => usageCounts(inv).groups, [inv]);
  const candidates = useMemo(() => {
    const list: (GroupInfo & { refs: number; orphan?: boolean })[] = [];
    for (const [id, n] of counts) {
      const g = inv.groups.get(id);
      list.push(g ? { ...g, refs: n } : { id, name: `Deleted group ${id.slice(0, 8)}…`, refs: n, orphan: inv.orphanedGroupIds.has(id) });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [inv, counts]);

  const needle = q.trim().toLowerCase();
  const matches = needle ? candidates.filter((g) => g.name.toLowerCase().includes(needle) || g.id.includes(needle)).slice(0, 30) : candidates.slice(0, 30);

  // Parent groups (nested membership, any depth) are always included.
  useEffect(() => {
    setParents(null);
    setParentErr(null);
    if (!picked) {
      setParentState("idle");
      return;
    }
    let live = true;
    setParentState("loading");
    loadParents(picked.id)
      .then((list) => {
        if (!live) return;
        setParents(list);
        setParentState("idle");
      })
      .catch((e) => {
        if (!live) return;
        setParentErr(describeError(e));
        setParentState("error");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.id, loadParents]);

  const refs = useMemo(() => (picked ? referencesToGroup(inv, picked.id, parents ?? []) : []), [inv, picked, parents]);
  const writable = refs.filter((r) => r.object.writable).length;
  const excludes = refs.filter((r) => r.assignment.intent === "exclude").length;
  const inherited = refs.filter((r) => r.via).length;
  const usedParents = parents ? parents.filter((p) => counts.has(p.id)) : [];

  async function searchTenant() {
    setSearching(true);
    setSearchErr(null);
    try {
      setTenantHits(await search(q.trim()));
    } catch (e) {
      setSearchErr(describeError(e));
    } finally {
      setSearching(false);
    }
  }

  const pick = (g: GroupInfo) => {
    setPicked(g);
    setSelected(new Set());
  };

  const selectedObjects = refs.filter((r) => selected.has(r.object.key)).map((r) => r.object);

  return (
    <>
      <div className="lookup">
        <aside className="card flush lookup-list">
          <div className="lookup-search">
            <label className="field">
              Entra group ({candidates.length} referenced)
              <input
                type="search"
                placeholder="Group name or object ID"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setTenantHits(null);
                }}
              />
            </label>
          </div>
          <ul className="pick-list">
            {matches.map((g) => (
              <li key={g.id}>
                <button className={picked?.id === g.id ? "pick active" : "pick"} onClick={() => pick(g)}>
                  <span className={g.orphan ? "pick-name warn-inline" : "pick-name"}>{g.name}</span>
                  <span className="count">{g.refs}</span>
                </button>
              </li>
            ))}
            {!matches.length && <li className="muted small pad">No referenced group matches.</li>}
          </ul>
          {needle.length >= 2 && (
            <div className="lookup-search">
              <button className="btn secondary compact full" onClick={searchTenant} disabled={searching}>
                {searching ? "Searching…" : `Search all groups in tenant for "${q.trim()}"`}
              </button>
              {searchErr && <p className="warn-inline small">{searchErr}</p>}
              {tenantHits && (
                <ul className="pick-list">
                  {tenantHits.map((g) => (
                    <li key={g.id}>
                      <button className={picked?.id === g.id ? "pick active" : "pick"} onClick={() => pick(g)}>
                        <span className="pick-name">{g.name}</span>
                        <span className="count">{counts.get(g.id) ?? 0}</span>
                      </button>
                    </li>
                  ))}
                  {!tenantHits.length && <li className="muted small pad">No groups found.</li>}
                </ul>
              )}
            </div>
          )}
        </aside>

        <section className="lookup-main">
          {!picked ? (
            <div className="card">
              <h2>Pick a group</h2>
              <p className="muted">
                See every policy, app, script and remediation that targets or excludes it. Use “Search all groups in tenant” to check a group
                that nothing references yet.
              </p>
            </div>
          ) : (
            <>
              <div className="card summary">
                <div>
                  <h1 className="page-title">{picked.name}</h1>
                  <p className="tenant-id">{picked.id}</p>
                </div>
                <div className="stats">
                  <Stat n={refs.length} label="references" />
                  {parents && <Stat n={inherited} label="via parent groups" cls="via" />}
                  <Stat n={writable} label="writable" cls="ok" />
                  <Stat n={refs.length - writable} label="read-only" cls="muted" />
                  <Stat n={excludes} label="as exclusion" cls="err" />
                </div>
                <div className="nested-row">
                  <span className="nested-label">Parent groups</span>
                  {parentState === "loading" && <span className="muted small">Reading group membership…</span>}
                  {parents && (
                    <span className="muted small">
                      {parents.length
                        ? `Member of ${parents.length} parent group${parents.length === 1 ? "" : "s"}${usedParents.length < parents.length ? `, ${usedParents.length} with assignments` : ""}: ${parents.map((p) => p.name).join(", ")}`
                        : "Not nested in any other group."}
                    </span>
                  )}
                </div>
                {parentErr && (
                  <p className="warn-inline small nested-err">Couldn't read parent groups: {parentErr}</p>
                )}
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
                        <th>Relation</th>
                        <th>Assignment filter</th>
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
                          <td>
                            <RelationPill a={r.assignment} />
                            {r.via && (
                              <span className="via-tag" title={`Assigned to ${r.via.name}, which ${picked.name} is nested in`}>
                                via {r.via.name}
                              </span>
                            )}
                          </td>
                          <td className="nowrap">
                            {r.assignment.filterId ? `${filterLabel(r.assignment, inv)} · ${r.assignment.filterMode === "exclude" ? "Exclude" : "Include"}` : "—"}
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
                <Completeness
                  inv={inv}
                  extra={
                    <span>
                      {parents
                        ? `Direct references plus ${parents.length} parent group${parents.length === 1 ? "" : "s"} (nested, any depth).`
                        : "Direct references only (parent groups could not be read)."}
                    </span>
                  }
                />
              </div>

              <div className="head-actions">
                <button
                  className="btn compact"
                  disabled={!refs.length}
                  onClick={() => onExport("xlsx", [...new Map(refs.map((r) => [r.object.key, r.object])).values()], `Group: ${picked.name}${parents ? ` (incl. ${parents.length} parent groups)` : ""}`)}
                >
                  Export .xlsx
                </button>
              </div>

              <SelectionBar
                count={selected.size}
                onExport={() => onExport("xlsx", selectedObjects, `Group ${picked.name} — selection`)}
                objects={selectedObjects}
                hint={{ groupId: picked.id }}
              />
            </>
          )}
        </section>
      </div>
    </>
  );
}

export function Stat({ n, label, cls }: { n: number; label: string; cls?: string }) {
  return (
    <div className="stat">
      <span className={`stat-n ${cls ?? ""}`}>{n.toLocaleString()}</span>
      <span className="muted small">{label}</span>
    </div>
  );
}
