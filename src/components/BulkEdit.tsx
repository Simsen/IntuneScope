import { useMemo, useRef, useState } from "react";
import {
  filterAllowed,
  FILTER_PLATFORMS,
  signature,
  splitByPlatform,
  type FilterRef,
  type Operation,
  type RawTarget,
  type TargetRef,
} from "../lib/editor";
import { applyChanges, backupJson, buildPreview, reportJson, RUN_LABEL, type EditorIO, type PreviewRow, type RunRow } from "../lib/editorRun";
import { download, stamp } from "../lib/export";
import { describeError } from "../lib/graph";
import { PLATFORM_LABEL, type GroupInfo, type IntuneObject, type Inventory, type PlatformKey } from "../lib/model";
import { normalizeAssignment } from "../lib/normalize";
import type { SessionInfo } from "../lib/session";
import type { BulkHint } from "./EditorContext";
import { AssignmentChip } from "./Shared";

type OpKind = Operation["op"];
type Step = "split" | "op" | "preview" | "run";

const OPS: { id: OpKind; title: string; text: string }[] = [
  { id: "add", title: "Add assignment", text: "Group, All Users or All Devices — include or exclude, optional filter" },
  { id: "replace", title: "Replace target", text: "Move assignments from one target to another, e.g. pilot → production" },
  { id: "remove", title: "Remove assignment", text: "Remove a target from the selected policies" },
  { id: "changeFilter", title: "Change filter", text: "Set, switch mode or remove a filter — by target or by filter" },
];

const targetKey = (t: TargetRef) => (t.kind === "group" ? `g:${t.groupId.toLowerCase()}` : t.kind);

/** Targets present on the given objects (from the loaded inventory) with how many policies use them. */
function presentTargets(objects: IntuneObject[]): { ref: TargetRef; count: number }[] {
  const m = new Map<string, { ref: TargetRef; count: number }>();
  for (const o of objects) {
    const seen = new Set<string>();
    for (const a of o.assignments) {
      const ref: TargetRef | null =
        a.targetKind === "group" && a.groupId ? { kind: "group", groupId: a.groupId } : a.targetKind === "allUsers" ? { kind: "allUsers" } : a.targetKind === "allDevices" ? { kind: "allDevices" } : null;
      if (!ref) continue;
      const k = targetKey(ref);
      if (seen.has(k)) continue;
      seen.add(k);
      m.set(k, { ref, count: (m.get(k)?.count ?? 0) + 1 });
    }
  }
  return [...m.values()];
}

function presentFilters(objects: IntuneObject[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of objects) for (const id of new Set(o.assignments.map((a) => a.filterId).filter(Boolean) as string[])) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function BulkEdit({
  inv,
  session,
  objects,
  hint,
  io,
  searchGroups,
  onClose,
  onApplied,
}: {
  inv: Inventory;
  session: SessionInfo;
  objects: IntuneObject[];
  hint?: BulkHint;
  io: EditorIO;
  searchGroups: (term: string) => Promise<GroupInfo[]>;
  onClose: () => void;
  onApplied: () => void;
}) {
  const unique = useMemo(() => [...new Map(objects.map((o) => [o.key, o])).values()], [objects]);
  const { batches, readOnly } = useMemo(() => splitByPlatform(unique), [unique]);
  const single = batches.size === 1 && !readOnly.length ? [...batches.keys()][0] : null;

  const [platform, setPlatform] = useState<PlatformKey | null>(single);
  const [step, setStep] = useState<Step>(single ? "op" : "split");
  const batch = platform ? batches.get(platform) ?? [] : [];

  // Names for groups picked via tenant search (not in the loaded inventory).
  const [extraGroups, setExtraGroups] = useState<Map<string, GroupInfo>>(new Map());
  const view = useMemo<Inventory>(() => ({ ...inv, groups: new Map([...inv.groups, ...extraGroups]) }), [inv, extraGroups]);
  const remember = (g: GroupInfo) => setExtraGroups((m) => new Map(m).set(g.id, g));
  const targetLabel = (t: TargetRef) =>
    t.kind === "allUsers"
      ? "All Users"
      : t.kind === "allDevices"
        ? "All Devices"
        : view.groups.get(t.groupId)?.name ?? (inv.orphanedGroupIds.has(t.groupId) ? `Deleted group ${t.groupId.slice(0, 8)}…` : t.groupId);

  // --- operation form state ---
  const hintGroupPresent = hint?.groupId && presentTargets(batch).some((p) => p.ref.kind === "group" && p.ref.groupId === hint.groupId);
  const [opKind, setOpKind] = useState<OpKind>(hint?.filterId ? "changeFilter" : hint?.groupId ? "replace" : "add");
  const [target, setTarget] = useState<TargetRef | null>(null);
  const [from, setFrom] = useState<TargetRef | null>(hintGroupPresent ? { kind: "group", groupId: hint!.groupId! } : null);
  const [intent, setIntent] = useState<"include" | "exclude">("include");
  const [filterId, setFilterId] = useState<string>("");
  const [filterMode, setFilterMode] = useState<"include" | "exclude">("include");
  const [matchBy, setMatchBy] = useState<"target" | "filter">(hint?.filterId ? "filter" : "target");
  const [matchFilter, setMatchFilter] = useState<string>(hint?.filterId ?? "");

  const allowedFilterPlatforms = platform ? FILTER_PLATFORMS[platform] : [];
  const platformFilters = [...inv.filters.values()].filter((f) => allowedFilterPlatforms.includes(f.platform)).sort((a, b) => a.name.localeCompare(b.name));
  const filter: FilterRef | null = filterId ? { id: filterId, mode: filterMode } : null;

  const op: Operation | null = (() => {
    switch (opKind) {
      case "add":
        return target ? { op: "add", target, intent, filter: intent === "include" ? filter : null } : null;
      case "replace":
        return from && target ? { op: "replace", from, to: target } : null;
      case "remove":
        return target ? { op: "remove", target } : null;
      case "changeFilter":
        if (matchBy === "target") return target ? { op: "changeFilter", match: { by: "target", target }, filter } : null;
        return matchFilter ? { op: "changeFilter", match: { by: "filter", filterId: matchFilter }, filter } : null;
    }
  })();
  const opError = op && platform ? filterAllowed(op, platform, (id) => inv.filters.get(id)?.platform) : null;

  // --- preview / run state ---
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [run, setRun] = useState<RunRow[] | null>(null);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);

  const meta = () => ({
    tenantId: session.tenantId,
    tenantName: session.tenantName,
    user: session.user,
    at: new Date().toISOString(),
    platform,
    operation: op,
    app: "IntuneScope Editor",
  });

  async function makePreview() {
    if (!op) return;
    setError(null);
    setPreview(null);
    setConfirmed(false);
    setRun(null);
    setStep("preview");
    setProgress(`Reading current assignments 0/${batch.length}…`);
    try {
      setPreview(await buildPreview(batch, op, io, (n) => setProgress(`Reading current assignments ${n}/${batch.length}…`)));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setProgress("");
    }
  }

  async function apply() {
    if (!preview) return;
    // Backup first — before a single write.
    download(`intunescope-backup-${stamp()}.json`, backupJson(preview, meta()), "application/json");
    stop.current = false;
    setRunning(true);
    setStep("run");
    const rows: RunRow[] = preview.map((r) => ({ object: r.object, status: r.plan.status === "change" ? "pending" : "skipped", message: r.plan.reason }));
    setRun([...rows]);
    const final = await applyChanges(
      preview,
      io,
      (i, r) => {
        rows[i] = r;
        setRun([...rows]);
      },
      () => stop.current,
    );
    setRun(final);
    setRunning(false);
    onApplied();
  }

  const changes = preview?.filter((r) => r.plan.status === "change").length ?? 0;
  const fName = (f: FilterRef | null) => (f ? `filter ${inv.filters.get(f.id)?.name ?? f.id} (${f.mode === "include" ? "include" : "exclude"} filtered devices)` : "no filter");
  const opText = (o: Operation | null): { text: string; deploys: boolean } => {
    if (!o) return { text: "", deploys: false };
    switch (o.op) {
      case "add":
        return o.intent === "exclude"
          ? { text: `EXCLUDE ${targetLabel(o.target)}`, deploys: false }
          : { text: `INCLUDE ${targetLabel(o.target)} with ${fName(o.filter)}`, deploys: true };
      case "replace":
        return { text: `Replace ${targetLabel(o.from)} with ${targetLabel(o.to)} (include/exclude and filter kept)`, deploys: true };
      case "remove":
        return { text: `Remove ${targetLabel(o.target)}`, deploys: false };
      case "changeFilter":
        return { text: `Set ${fName(o.filter)} on assignments ${o.match.by === "target" ? `to ${targetLabel(o.match.target)}` : `using ${inv.filters.get(o.match.filterId)?.name ?? "that filter"}`}`, deploys: true };
    }
  };
  const described = opText(op);
  const counts = (s: string) => preview?.filter((r) => r.plan.status === s).length ?? 0;

  return (
    <section className="bulk">
      <div className="bulk-head">
        <div>
          <h1 className="page-title">Bulk edit</h1>
          <p className="muted small">
            {platform ? `${batch.length} ${PLATFORM_LABEL[platform]} ${batch.length === 1 ? "policy" : "policies"}` : `${unique.length} selected`} · tenant{" "}
            <strong>{session.tenantName}</strong>
          </p>
        </div>
        <div className="row">
          <div className="bulk-steps" aria-label="Steps">
            {(["op", "preview", "run"] as Step[]).map((s, i) => (
              <span key={s} className={step === s ? "on" : undefined}>
                {i + 1} · {s === "op" ? "Change" : s === "preview" ? "Preview" : "Apply"}
              </span>
            ))}
          </div>
          <button className="btn secondary compact" onClick={onClose} disabled={running}>
            {run && !running ? "Close" : "Cancel"}
          </button>
        </div>
      </div>

      {step === "split" && (
        <div className="card">
          <h2>{batches.size > 1 ? `Your selection spans ${batches.size} platforms` : "Some selected objects can't be edited"}</h2>
          <p className="muted">
            Assignment filters are platform-specific and Intune does not check that a filter matches the policy, so IntuneScope edits one platform
            at a time.
          </p>
          <div className="split-list">
            {[...batches].map(([p, list]) => (
              <div className="split-row" key={p}>
                <span>
                  <strong>{PLATFORM_LABEL[p]}</strong> <span className="muted">· {list.length} {list.length === 1 ? "policy" : "policies"}</span>
                </span>
                <button
                  className="btn compact editor-action"
                  onClick={() => {
                    setPlatform(p);
                    setStep("op");
                  }}
                >
                  Edit these
                </button>
              </div>
            ))}
          </div>
          {readOnly.length > 0 && (
            <p className="muted small">
              {readOnly.length} read-only {readOnly.length === 1 ? "object is" : "objects are"} left out (apps, scripts, remediations, update
              profiles, Autopilot and other templates): {readOnly.slice(0, 5).map((o) => o.name).join(", ")}
              {readOnly.length > 5 ? "…" : ""}
            </p>
          )}
        </div>
      )}

      {step === "op" && platform && (
        <div className="card">
          <div className="op-grid" role="radiogroup" aria-label="Operation">
            {OPS.map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={opKind === o.id}
                className={opKind === o.id ? "op-card on" : "op-card"}
                onClick={() => {
                  setOpKind(o.id);
                  setTarget(null);
                }}
              >
                <b>{o.title}</b>
                <span>{o.text}</span>
              </button>
            ))}
          </div>

          <div className="form-grid" style={{ marginTop: 16 }}>
            {opKind === "replace" && (
              <PresentPicker label="From target" options={presentTargets(batch)} value={from} onChange={setFrom} labelFor={targetLabel} total={batch.length} />
            )}
            {(opKind === "remove" || (opKind === "changeFilter" && matchBy === "target")) && (
              <PresentPicker
                label={opKind === "remove" ? "Target to remove" : "Assignments to target"}
                options={presentTargets(batch)}
                value={target}
                onChange={setTarget}
                labelFor={targetLabel}
                total={batch.length}
              />
            )}
            {(opKind === "add" || opKind === "replace") && (
              <TargetPicker
                label={opKind === "replace" ? "To target" : "Target"}
                inv={view}
                value={target}
                onChange={setTarget}
                search={searchGroups}
                remember={remember}
                labelFor={targetLabel}
              />
            )}

            {opKind === "changeFilter" && (
              <div className="field">
                Match assignments by
                <div className="seg">
                  <button className={matchBy === "target" ? "on" : ""} onClick={() => setMatchBy("target")}>
                    Target
                  </button>
                  <button className={matchBy === "filter" ? "on" : ""} onClick={() => setMatchBy("filter")}>
                    Current filter
                  </button>
                </div>
                {matchBy === "filter" && (
                  <select value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)}>
                    <option value="">Choose a filter in use…</option>
                    {[...presentFilters(batch)].map(([id, n]) => (
                      <option key={id} value={id}>
                        {inv.filters.get(id)?.name ?? id} · {n} {n === 1 ? "policy" : "policies"}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {opKind === "add" && (
              <div className="field">
                Assignment
                <div className="seg">
                  <button className={intent === "include" ? "on" : ""} onClick={() => setIntent("include")}>
                    Include
                  </button>
                  <button
                    className={intent === "exclude" ? "on" : ""}
                    disabled={!!target && target.kind !== "group"}
                    title="Only groups can be excluded"
                    onClick={() => setIntent("exclude")}
                  >
                    Exclude
                  </button>
                </div>
              </div>
            )}

            {(opKind === "add" || opKind === "changeFilter") && (
              <div className="field">
                {opKind === "changeFilter" ? "New filter" : "Filter (optional)"}
                {opKind === "add" && intent === "exclude" ? (
                  <span className="small">Filters can't be used on exclusions.</span>
                ) : allowedFilterPlatforms.length === 0 ? (
                  <span className="small">Filters aren't available for {PLATFORM_LABEL[platform]} policies.</span>
                ) : (
                  <>
                    <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
                      <option value="">{opKind === "changeFilter" ? "None — remove the filter" : "No filter"}</option>
                      {platformFilters.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name} · {f.platformLabel}
                        </option>
                      ))}
                    </select>
                    {filterId && (
                      <div className="seg">
                        <button className={filterMode === "include" ? "on" : ""} onClick={() => setFilterMode("include")}>
                          Include filtered devices
                        </button>
                        <button className={filterMode === "exclude" ? "on" : ""} onClick={() => setFilterMode("exclude")}>
                          Exclude filtered devices
                        </button>
                      </div>
                    )}
                    {!platformFilters.length && <span className="small">No {PLATFORM_LABEL[platform]} filters in this tenant.</span>}
                  </>
                )}
              </div>
            )}
          </div>

          {opError && <p className="warn-inline small">{opError}</p>}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn editor-action" disabled={!op || !!opError} onClick={makePreview}>
              Preview changes
            </button>
            {batches.size > 1 || readOnly.length ? (
              <button className="btn secondary" onClick={() => setStep("split")}>
                Back to platforms
              </button>
            ) : null}
          </div>
          <p className="muted small">Nothing is written until you confirm on the next screen. The preview reads every policy fresh from Intune.</p>
        </div>
      )}

      {(step === "preview" || step === "run") && (
        <>
          {error && (
            <div className="card error-card">
              <h2>Preview failed</h2>
              <p className="small">{error}</p>
            </div>
          )}
          {progress && <p className="muted">{progress}</p>}
          {preview && step === "preview" && (
            <div className="card">
              <div style={{ marginBottom: 6 }}>
                <span className="muted">Operation: </span>
                <strong>{described.text}</strong>
              </div>
              {described.deploys && changes > 0 && (
                <div className="warn-inline small" style={{ marginBottom: 6 }}>
                  This changes which devices or users receive these policies as soon as Intune syncs.
                </div>
              )}
              <strong>
                {changes} {changes === 1 ? "policy" : "policies"} will change
              </strong>
              <span className="muted">
                {" "}
                · {counts("noChange")} no change · {counts("invalid")} can't be changed
              </span>
            </div>
          )}
          {preview && (
            <div className="card flush">
              <div className="table-wrap">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Policy</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>{step === "run" ? "Result" : "Status"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => {
                      const res = run?.[i];
                      return (
                        <tr key={r.object.key}>
                          <td className="strong">
                            {r.object.name}
                            <div className="muted small">{r.object.typeLabel}</div>
                          </td>
                          <td>
                            <Chips targets={r.plan.before} other={r.plan.after} inv={view} mark="removed" />
                          </td>
                          <td>{r.plan.status === "change" ? <Chips targets={r.plan.after} other={r.plan.before} inv={view} mark="added" /> : <span className="muted small">—</span>}</td>
                          <td>
                            {res ? (
                              <>
                                <span className={`status ${res.status}`}>{RUN_LABEL[res.status]}</span>
                                {res.message && <div className="muted small">{res.message}</div>}
                              </>
                            ) : (
                              <>
                                <span className={`status ${r.plan.status}`}>{r.plan.status === "change" ? "Change" : r.plan.status === "noChange" ? "No change" : "Can't change"}</span>
                                {r.plan.reason && <div className="muted small">{r.plan.reason}</div>}
                                {r.plan.status === "change" && r.plan.after.some((t) => t.groupId && inv.orphanedGroupIds.has(t.groupId)) && (
                                  <div className="warn-inline small">Keeps an assignment to a deleted group — Intune may reject the write.</div>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview && step === "preview" && (
            <div className="card warn">
              <label className="confirm">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!changes} />
                <span>
                  I've reviewed the changes. Write them to <strong>{session.tenantName}</strong> now. A JSON backup of the current assignments
                  downloads first; each policy is re-checked right before writing and verified afterwards.
                </span>
              </label>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn editor-action" disabled={!confirmed || !changes} onClick={apply}>
                  Apply {changes} {changes === 1 ? "change" : "changes"}
                </button>
                <button className="btn secondary" onClick={() => setStep("op")}>
                  Back
                </button>
              </div>
            </div>
          )}

          {run && (
            <div className="card">
              <strong>{running ? "Applying…" : "Done"}</strong>{" "}
              <span className="muted">
                {(["ok", "failed", "changed", "verifyFailed"] as const)
                  .map((s) => [s, run.filter((r) => r.status === s).length] as const)
                  .filter(([, n]) => n)
                  .map(([s, n]) => `${n} ${RUN_LABEL[s].toLowerCase()}`)
                  .join(" · ") || "nothing written yet"}
              </span>
              <div className="row" style={{ marginTop: 12 }}>
                {running ? (
                  <button className="btn secondary" onClick={() => (stop.current = true)}>
                    Stop after current policy
                  </button>
                ) : (
                  <>
                    <button className="btn secondary" onClick={() => download(`intunescope-report-${stamp()}.json`, reportJson(run, meta()), "application/json")}>
                      Download execution report
                    </button>
                    <button className="btn" onClick={onClose}>
                      Done
                    </button>
                  </>
                )}
              </div>
              {!running && <p className="muted small">Not atomic: policies that succeeded stay changed even if others failed. Use the backup to restore.</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Chips({ targets, other, inv, mark }: { targets: RawTarget[]; other: RawTarget[]; inv: Inventory; mark: "added" | "removed" }) {
  if (!targets.length) return <span className="chip none">Unassigned</span>;
  const otherKeys = new Set(other.map((t) => signature([t])));
  return (
    <div className="diff chips">
      {targets.map((t, i) => (
        <span key={i} className={otherKeys.has(signature([t])) ? undefined : mark}>
          <AssignmentChip a={normalizeAssignment({ target: t as never })} inv={inv} />
        </span>
      ))}
    </div>
  );
}

function PresentPicker({
  label,
  options,
  value,
  onChange,
  labelFor,
  total,
}: {
  label: string;
  options: { ref: TargetRef; count: number }[];
  value: TargetRef | null;
  onChange: (t: TargetRef) => void;
  labelFor: (t: TargetRef) => string;
  total: number;
}) {
  const sorted = [...options].sort((a, b) => b.count - a.count || labelFor(a.ref).localeCompare(labelFor(b.ref)));
  return (
    <div className="field">
      {label}
      {sorted.length ? (
        <div className="picker-list">
          {sorted.map((o) => (
            <button key={targetKey(o.ref)} className={value && targetKey(value) === targetKey(o.ref) ? "on" : ""} onClick={() => onChange(o.ref)}>
              <span>{labelFor(o.ref)}</span>
              <span className="muted">
                {o.count}/{total}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <span className="small">None of the selected policies has an assignment yet.</span>
      )}
    </div>
  );
}

function TargetPicker({
  label,
  inv,
  value,
  onChange,
  search,
  remember,
  labelFor,
}: {
  label: string;
  inv: Inventory;
  value: TargetRef | null;
  onChange: (t: TargetRef) => void;
  search: (term: string) => Promise<GroupInfo[]>;
  remember: (g: GroupInfo) => void;
  labelFor: (t: TargetRef) => string;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GroupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const local = needle ? [...inv.groups.values()].filter((g) => g.name.toLowerCase().includes(needle) || g.id === needle).slice(0, 20) : [];
  const list = hits ?? local;
  const isOn = (t: TargetRef) => !!value && targetKey(value) === targetKey(t);

  async function doSearch() {
    setBusy(true);
    setErr(null);
    try {
      setHits(await search(q.trim()));
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      {label}
      <div className="seg">
        <button className={value?.kind === "allUsers" ? "on" : ""} onClick={() => onChange({ kind: "allUsers" })}>
          All Users
        </button>
        <button className={value?.kind === "allDevices" ? "on" : ""} onClick={() => onChange({ kind: "allDevices" })}>
          All Devices
        </button>
      </div>
      <input
        type="search"
        placeholder="…or search a group by name"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHits(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && needle.length >= 2 && doSearch()}
      />
      {needle.length >= 2 && (
        <div className="picker-list">
          {list.map((g) => (
            <button
              key={g.id}
              className={isOn({ kind: "group", groupId: g.id }) ? "on" : ""}
              onClick={() => {
                remember(g);
                onChange({ kind: "group", groupId: g.id });
              }}
            >
              <span>{g.name}</span>
            </button>
          ))}
          {!hits && (
            <button onClick={doSearch} disabled={busy}>
              <span className="muted">{busy ? "Searching…" : `Search all groups in tenant for "${q.trim()}"`}</span>
            </button>
          )}
          {hits && !hits.length && <span className="muted small pad">No groups found.</span>}
        </div>
      )}
      {err && <span className="warn-inline small">{err}</span>}
      {value && (
        <span className="chosen">
          Selected: <strong>{labelFor(value)}</strong>
        </span>
      )}
    </div>
  );
}
