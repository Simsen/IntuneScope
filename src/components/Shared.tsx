import { useState, type ReactNode } from "react";
import { REPO_URL } from "../config";
import type { Assignment, IntuneObject, Inventory } from "../lib/model";
import { useEditor, type BulkHint } from "./EditorContext";
import { completeness, filterLabel, isOrphaned, targetName } from "../lib/query";

export function GitHubLink() {
  return (
    <a className="gh-link" href={REPO_URL} target="_blank" rel="noreferrer">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
      </svg>
      GitHub
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      IntuneScope.app is owned and maintained by{" "}
      <a href="https://www.linkedin.com/in/simoneriksendk/" target="_blank" rel="noopener noreferrer">
        Simon Hartmann Eriksen
      </a>
      .
    </footer>
  );
}

const FunnelIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 4h18l-7 9v6l-4 2v-8z" />
  </svg>
);

/** One assignment rendered as a chip: +/− target, optional filter with mode. */
export function AssignmentChip({ a, inv }: { a: Assignment; inv: Inventory }) {
  const orphan = isOrphaned(a, inv);
  const cls = orphan ? "chip orphan" : a.intent === "exclude" ? "chip exc" : "chip inc";
  const sign = orphan ? "!" : a.intent === "exclude" ? "−" : "+";
  return (
    <span className={cls} title={a.groupId ?? undefined}>
      <b>{sign}</b> {targetName(a, inv)}
      {a.appIntent && <span className="chip-meta">{a.appIntent}</span>}
      {a.filterId && (
        <span className="chip-filter">
          <FunnelIcon /> {filterLabel(a, inv)} · {a.filterMode === "exclude" ? "Excl" : "Incl"}
        </span>
      )}
    </span>
  );
}

export function RelationPill({ a }: { a: Assignment }) {
  if (a.appIntent) return <span className={`pill ${a.intent === "exclude" ? "exc" : "inc"}`}>{a.intent === "exclude" ? "Exclude" : a.appIntent}</span>;
  return <span className={`pill ${a.intent === "exclude" ? "exc" : "inc"}`}>{a.intent === "exclude" ? "Exclude" : "Include"}</span>;
}

export function Writable({ yes }: { yes: boolean }) {
  return (
    <span className={yes ? "writable" : "muted small"} title={yes ? "Editable with IntuneScope Editor (v1.0)" : "Read-only in IntuneScope"}>
      {yes ? "Writable" : "Read-only"}
    </span>
  );
}

/** "Searched / not searched" footer — completeness is part of every answer. */
export function Completeness({ inv, extra }: { inv: Inventory; extra?: ReactNode }) {
  const { searched, notSearched } = completeness(inv.status);
  return (
    <div className="table-foot">
      <span>
        <strong>Searched:</strong> {searched.join(" · ") || "nothing"}
      </span>
      {notSearched.length > 0 && (
        <span className="warn-inline">
          <strong>Not searched:</strong> {notSearched.join(" · ")}
        </span>
      )}
      {extra}
      <span>Limited to objects your Intune role and scope tags can see.</span>
    </div>
  );
}

export function ModeBadge({ demo, editor }: { demo?: boolean; editor?: boolean }) {
  if (demo) return <span className="mode demo">Demo · sample data</span>;
  if (editor) return <span className="mode editor">Editor · read/write</span>;
  return <span className="mode">Explorer · read-only</span>;
}

/** Selection bar: export, and bulk edit (Editor) or the Editor teaser (Explorer). */
export function SelectionBar({
  count,
  note,
  onExport,
  objects = [],
  hint,
}: {
  count: number;
  note?: string;
  onExport: () => void;
  objects?: IntuneObject[];
  hint?: BulkHint;
}) {
  const [open, setOpen] = useState(false);
  const { editor, canEditor, onSwitchToEditor, startBulkEdit } = useEditor();
  if (!count) return null;
  const writable = new Set(objects.filter((o) => o.writable).map((o) => o.key)).size;
  return (
    <div className="selbar">
      <div className="selbar-row">
        <strong>{count} selected</strong>
        {note && <span className="muted small">{note}</span>}
        <div className="selbar-actions">
          <button className="btn secondary compact" onClick={onExport}>
            Export selection
          </button>
          {editor ? (
            <button
              className="btn compact editor-action"
              disabled={!writable}
              title={writable ? undefined : "None of the selected objects can be edited (apps, scripts and some templates are read-only)."}
              onClick={() => startBulkEdit(objects, hint)}
            >
              Bulk edit {writable ? `${writable} ${writable === 1 ? "policy" : "policies"}` : "— nothing writable"}
            </button>
          ) : (
            <button className="btn ghost compact" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {canEditor ? "Bulk edit…" : "Bulk edit — coming in v1.0"}
            </button>
          )}
        </div>
      </div>
      {open && !editor && (
        <div className="teaser">
          <p>
            <strong>IntuneScope Editor</strong> changes assignments on the selected policies in one go:
          </p>
          <ul>
            <li>Add an assignment (group, All Users or All Devices, with an optional filter)</li>
            <li>Replace a target — e.g. pilot group → production group</li>
            <li>Remove an assignment</li>
            <li>Change, switch mode on or remove an assignment filter</li>
          </ul>
          <p className="muted small">
            Every change is previewed before/after, backed up as JSON and verified after writing. The Editor uses a separate app registration with
            write permission, so your tenant can approve read-only access without ever granting write.
          </p>
          {canEditor && (
            <button className="btn compact editor-action" onClick={onSwitchToEditor}>
              Sign in as Editor
            </button>
          )}
        </div>
      )}
    </div>
  );
}
