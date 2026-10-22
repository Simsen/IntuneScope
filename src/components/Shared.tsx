import { useState, type ReactNode } from "react";
import { REPO_URL } from "../config";
import type { Assignment, Inventory } from "../lib/model";
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
  return <span className={yes ? "writable" : "muted small"}>{yes ? "Writable (v1.0)" : "Read-only"}</span>;
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

/** Selection bar with export + the single v1.0 teaser. */
export function SelectionBar({ count, note, onExport }: { count: number; note?: string; onExport: () => void }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;
  return (
    <div className="selbar">
      <div className="selbar-row">
        <strong>{count} selected</strong>
        {note && <span className="muted small">{note}</span>}
        <div className="selbar-actions">
          <button className="btn secondary compact" onClick={onExport}>
            Export selection
          </button>
          <button className="btn ghost compact" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Bulk edit — coming in v1.0
          </button>
        </div>
      </div>
      {open && (
        <div className="teaser">
          <p>
            <strong>IntuneScope Editor (v1.0)</strong> will let you change assignments on the selected policies in one go:
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
        </div>
      )}
    </div>
  );
}
