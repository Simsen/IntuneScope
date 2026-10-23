import type { WorkloadStatus } from "../lib/model";
import type { SessionInfo } from "../lib/session";
import { ModeBadge } from "./Shared";

const GLYPH = { done: "✓", loading: "…", error: "!", queued: "·", skipped: "–" } as const;
const STATE = { done: "Loaded", loading: "Loading", error: "Failed", queued: "Queued", skipped: "Skipped" } as const;

export function Loading({
  status,
  session,
  done,
  demo,
  editor,
  onContinue,
  onSignOut,
}: {
  status: WorkloadStatus[];
  session: SessionInfo | null;
  done: boolean;
  demo?: boolean;
  editor?: boolean;
  onContinue: () => void;
  onSignOut: () => void;
}) {
  const finished = status.filter((s) => s.state === "done" || s.state === "error" || s.state === "skipped").length;
  const pct = status.length ? Math.round((finished / status.length) * 100) : 0;
  const objects = status.filter((s) => s.id !== "filters" && s.id !== "groups").reduce((n, s) => n + s.count, 0);
  const failed = status.filter((s) => s.state === "error");
  const skipped = status.filter((s) => s.state === "skipped");

  return (
    <div className="app">
      <header className="top">
        <div className="top-row">
          <span className="brand">
            IntuneScope<span className="muted">.app</span>
          </span>
          <ModeBadge demo={demo} editor={editor} />
        </div>
        {session && (
          <div className="who">
            <div className="tenant">
              <span className="tenant-name">{session.tenantName}</span>
              <span className="tenant-id">{session.tenantId}</span>
            </div>
            <span className="user">{session.user}</span>
          </div>
        )}
      </header>

      <section className="card flush">
        <div className="load-head">
          <div className="load-title">
            <h2>{done ? "Inventory loaded" : "Loading inventory"}</h2>
            <span className="progress small">
              {finished} of {status.length} · {objects.toLocaleString()} objects
            </span>
          </div>
          <div className="bar" role="progressbar" aria-label="Overall progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <ul className="load-list">
          {status.map((s) => (
            <li key={s.id}>
              <span className={`dot ${s.state}`} aria-hidden="true">
                {GLYPH[s.state]}
              </span>
              <span className="load-name">{s.label}</span>
              <span className="muted small">{s.state === "error" ? s.error : s.detail ?? ""}</span>
              <span className={`pill ${s.state}`}>{STATE[s.state]}</span>
            </li>
          ))}
        </ul>
      </section>

      {failed.length > 0 && (
        <div className="card warn">
          <strong>
            {failed.length} workload{failed.length > 1 ? "s" : ""} could not be loaded.
          </strong>{" "}
          Lookups will say what was not searched. Usually this means your Intune role can't read that workload.
        </div>
      )}

      {skipped.length > 0 && (
        <div className="card">
          <strong>Editor mode loads only what it can edit or needs for lookups.</strong>{" "}
          <span className="muted">{skipped.map((s) => s.label).join(", ")} are shown in Explorer — sign in as Explorer to see them.</span>
        </div>
      )}

      <p className="muted small">
        Data stays in this browser tab — nothing is stored or sent anywhere except Microsoft. Results are limited to objects your Intune role and
        scope tags can see.
      </p>

      <div className="row">
        <button className="btn" disabled={!done} onClick={onContinue}>
          {done ? (failed.length ? "Continue with partial data" : "Continue") : "Loading…"}
        </button>
        <button className="btn secondary" onClick={onSignOut}>
          {demo ? "Exit demo" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
