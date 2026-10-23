import { useMemo, useState } from "react";
import { demoIO } from "../lib/demoEditor";
import { graphIO } from "../lib/editorRun";
import { exportInventory } from "../lib/exportInventory";
import type { GroupInfo, IntuneObject, Inventory } from "../lib/model";
import type { SessionInfo } from "../lib/session";
import { FilterLookup } from "./FilterLookup";
import { GroupLookup } from "./GroupLookup";
import { PolicyView } from "./PolicyView";
import { BulkEdit } from "./BulkEdit";
import { EditorContext, type BulkHint, type EditorCtx } from "./EditorContext";
import { GitHubLink, ModeBadge } from "./Shared";

type Tab = "policies" | "groups" | "filters";

export function Explorer({
  inv,
  session,
  demo,
  editor,
  canEditor,
  onSwitchToEditor,
  searchGroups,
  onRefresh,
  onDemoApplied,
  onSignOut,
}: {
  inv: Inventory;
  session: SessionInfo;
  demo: boolean;
  /** Signed in with the Editor registration. */
  editor: boolean;
  canEditor: boolean;
  onSwitchToEditor: () => void;
  onDemoApplied: () => void;
  searchGroups: (term: string) => Promise<GroupInfo[]>;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("policies");
  const [bulk, setBulk] = useState<{ objects: IntuneObject[]; hint?: BulkHint } | null>(null);
  const [stale, setStale] = useState(false);
  // Demo mode lets anyone try the Editor against the in-memory sample tenant.
  const canWrite = editor || demo;
  const io = useMemo(() => (demo ? demoIO() : graphIO), [demo]);
  const ctx: EditorCtx = {
    editor: canWrite,
    canEditor,
    onSwitchToEditor,
    startBulkEdit: (objects, hint) => setBulk({ objects, hint }),
  };
  const onExport = (format: "xlsx" | "csv", objects: IntuneObject[], scope: string) => exportInventory(format, objects, inv, session, scope);
  const time = inv.loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="app full">
      <header className="top">
        <div className="top-row wrap">
          <div className="brand-row">
            <span className="brand">
              IntuneScope<span className="muted">.app</span>
            </span>
            <ModeBadge demo={demo} editor={editor} />
          </div>
          <div className="header-meta">
            <div className="tenant">
              <span className="tenant-name">{session.tenantName}</span>
              <span className="tenant-id">{session.defaultDomain || session.tenantId}</span>
            </div>
            <span className="user">{session.user}</span>
            <span className="muted small">Loaded {time}</span>
            <button className="btn secondary compact" onClick={onRefresh}>
              Refresh
            </button>
            {!demo && !editor && canEditor && (
              <button className="link small" onClick={onSwitchToEditor}>
                Switch to Editor
              </button>
            )}
            <button className="link small" onClick={onSignOut}>
              {demo ? "Exit demo" : "Sign out"}
            </button>
            <GitHubLink />
          </div>
        </div>
        <nav className="tabs" aria-label="Views">
          {(
            [
              ["policies", "Policies"],
              ["groups", "Group lookup"],
              ["filters", "Filter lookup"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tab === id && !bulk ? "tab active" : "tab"}
              aria-current={tab === id && !bulk ? "page" : undefined}
              disabled={!!bulk}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {demo && (
        <div className="demo-banner" role="note">
          <strong>Demo mode.</strong> You are looking at a fictional Contoso tenant with sample data — nothing is read from Microsoft. Exports and
          Bulk edit work on the sample data — select a few policies to try it.{" "}
          <button className="link" onClick={onSignOut}>
            Exit demo
          </button>
        </div>
      )}

      {editor && (
        <div className="editor-banner" role="note">
          <strong>Editor mode.</strong> Signed in with write access to <b>{session.tenantName}</b>. Select policies and use Bulk edit — nothing is
          written until you confirm a preview.
        </div>
      )}
      {stale && !bulk && (
        <div className="editor-banner" role="status">
          Assignments were changed. The tables still show the inventory from {time}.
          <button className="btn secondary compact" onClick={onRefresh}>
            Refresh now
          </button>
        </div>
      )}

      <EditorContext.Provider value={ctx}>
        <main className="view">
          {bulk ? (
            <BulkEdit
              inv={inv}
              session={session}
              objects={bulk.objects}
              hint={bulk.hint}
              io={io}
              searchGroups={searchGroups}
              onClose={() => setBulk(null)}
              onApplied={() => (demo ? onDemoApplied() : setStale(true))}
            />
          ) : (
            <>
              {tab === "policies" && <PolicyView inv={inv} onExport={onExport} />}
              {tab === "groups" && <GroupLookup inv={inv} onExport={onExport} search={searchGroups} />}
              {tab === "filters" && <FilterLookup inv={inv} onExport={onExport} />}
            </>
          )}
        </main>
      </EditorContext.Provider>
    </div>
  );
}
