import type { IntuneObject, Inventory } from "./model";
import { completeness, EXPORT_COLUMNS, exportRows } from "./query";
import type { SessionInfo } from "./session";
import { download, stamp, toCsv, toXlsx } from "./export";

/** Build and download an export of `objects` (the current view or everything). */
export function exportInventory(format: "xlsx" | "csv", objects: IntuneObject[], inv: Inventory, session: SessionInfo, scope: string): void {
  const rows = exportRows(objects, inv);
  const base = `IntuneScope-${(session.defaultDomain || session.tenantName).replace(/[^\w.-]+/g, "_")}-${stamp()}`;
  if (format === "csv") {
    download(`${base}.csv`, toCsv(EXPORT_COLUMNS, rows), "text/csv;charset=utf-8");
    return;
  }
  const { searched, notSearched } = completeness(inv.status);
  const about: string[][] = [
    ["IntuneScope export"],
    [],
    ["Tenant", session.tenantName],
    ["Tenant ID", session.tenantId],
    ["Default domain", session.defaultDomain],
    ["Exported by", session.user],
    ["Exported at", new Date().toISOString()],
    ["Inventory loaded at", inv.loadedAt.toISOString()],
    ["Scope", scope],
    ["Objects", String(objects.length)],
    ["Rows (one per assignment)", String(rows.length)],
    [],
    ["Searched workloads", searched.join("; ")],
    ["Not searched", notSearched.length ? notSearched.join("; ") : "None"],
    [],
    ["Note", "Results are limited to objects the signed-in user's Intune role and scope tags can see."],
    ["Note", "Group references are direct only; membership through nested groups is not resolved."],
  ];
  const xlsx = toXlsx([
    { name: "Assignments", header: EXPORT_COLUMNS, rows, widths: [40, 18, 30, 12, 34, 12, 10, 12, 28, 11, 10, 38, 38, 38] },
    { name: "About", rows: about, widths: [26, 90] },
  ]);
  download(`${base}.xlsx`, new Uint8Array(xlsx), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
