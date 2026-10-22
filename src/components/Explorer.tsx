import { useState } from "react";
import { exportInventory } from "../lib/exportInventory";
import type { IntuneObject, Inventory } from "../lib/model";
import type { SessionInfo } from "../lib/session";
import { FilterLookup } from "./FilterLookup";
import { GroupLookup } from "./GroupLookup";
import { PolicyView } from "./PolicyView";
import { GitHubLink } from "./Shared";

type Tab = "policies" | "groups" | "filters";

export function Explorer({
  inv,
  session,
  onRefresh,
  onSignOut,
}: {
  inv: Inventory;
  session: SessionInfo;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("policies");
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
            <span className="mode">Explorer · read-only</span>
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
            <button className="link small" onClick={onSignOut}>
              Sign out
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
            <button key={id} className={tab === id ? "tab active" : "tab"} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="view">
        {tab === "policies" && <PolicyView inv={inv} onExport={onExport} />}
        {tab === "groups" && <GroupLookup inv={inv} onExport={onExport} />}
        {tab === "filters" && <FilterLookup inv={inv} onExport={onExport} />}
      </main>
    </div>
  );
}
