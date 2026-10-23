/**
 * Editor execution: preview (fresh read) → apply with compare-and-skip → verify by read-back.
 * Graph access is injected (EditorIO) so the whole flow is unit-testable without a tenant.
 */
import { batchGet, graph, GraphError } from "./graph";
import {
  assignBody,
  extractTargets,
  planOperation,
  signature,
  WRITE_COLLECTION,
  type Operation,
  type PolicyPlan,
  type RawAssignment,
  type RawTarget,
} from "./editor";
import type { IntuneObject } from "./model";

export interface EditorIO {
  readMany(objects: IntuneObject[], onProgress?: (done: number) => void): Promise<(RawAssignment[] | Error)[]>;
  read(object: IntuneObject): Promise<RawAssignment[]>;
  write(object: IntuneObject, targets: RawTarget[]): Promise<void>;
}

const path = (o: IntuneObject) => {
  const c = WRITE_COLLECTION[o.workload];
  if (!c) throw new Error(`${o.workload} is not writable.`);
  return `/deviceManagement/${c}/${encodeURIComponent(o.id)}`;
};

/** Real Microsoft Graph (beta — the same endpoints verified in the 2026-10-23 write spike). */
export const graphIO: EditorIO = {
  async readMany(objects, onProgress) {
    const res = await batchGet<{ value: RawAssignment[] }>(objects.map((o) => `${path(o)}/assignments`), onProgress);
    return objects.map((_, i) => {
      const r = res.get(i);
      return r instanceof GraphError ? r : r ? r.value ?? [] : new Error("No response");
    });
  },
  async read(o) {
    return (await graph<{ value: RawAssignment[] }>(`${path(o)}/assignments`)).value ?? [];
  },
  async write(o, targets) {
    await graph(`${path(o)}/assign`, { method: "POST", body: JSON.stringify(assignBody(targets)) });
  },
};

export interface PreviewRow {
  object: IntuneObject;
  /** Raw assignments exactly as read for the preview — the backup and the compare-and-skip baseline. */
  raw: RawAssignment[];
  snapshot: string;
  plan: PolicyPlan;
}

/** Fresh read of every policy, then plan the operation against what Intune has *now* (not the loaded inventory). */
export async function buildPreview(objects: IntuneObject[], op: Operation, io: EditorIO, onProgress?: (done: number) => void): Promise<PreviewRow[]> {
  const reads = await io.readMany(objects, onProgress);
  return objects.map((object, i) => {
    const r = reads[i];
    if (r instanceof Error) {
      const msg = r instanceof GraphError && (r.status === 401 || r.status === 403) ? "No access to read this policy's assignments." : r.message;
      return { object, raw: [], snapshot: "", plan: { status: "invalid", reason: `Could not read: ${msg}`, before: [], after: [] } };
    }
    const { targets, blocked } = extractTargets(r);
    const plan: PolicyPlan = blocked ? { status: "invalid", reason: blocked, before: targets, after: targets } : planOperation(targets, op);
    return { object, raw: r, snapshot: signature(targets), plan };
  });
}

export type RunStatus = "pending" | "writing" | "ok" | "skipped" | "changed" | "failed" | "verifyFailed";
export const RUN_LABEL: Record<RunStatus, string> = {
  pending: "Waiting",
  writing: "Writing…",
  ok: "Succeeded",
  skipped: "Skipped",
  changed: "Changed since preview",
  failed: "Failed",
  verifyFailed: "Verification failed",
};

export interface RunRow {
  object: IntuneObject;
  status: RunStatus;
  message?: string;
  /** Assignments re-read immediately before writing — the exact restore source. */
  preWrite?: RawTarget[];
  written?: RawTarget[];
  readBack?: RawTarget[];
  ms?: number;
}

function errMessage(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.status === 401 || e.status === 403) return `${e.status} — your Intune role can't change this policy.`;
    if (e.status === 429) return "Throttled by Intune — try again in a minute.";
    return `${e.status} — ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Apply sequentially. Every write equals an approved preview:
 * re-read → signature must equal the preview snapshot → POST the previewed set → re-read and compare.
 * Rows that were not "change" in the preview are skipped without any call.
 */
export async function applyChanges(rows: PreviewRow[], io: EditorIO, onRow: (i: number, r: RunRow) => void, shouldStop: () => boolean = () => false): Promise<RunRow[]> {
  const out: RunRow[] = rows.map((r) => ({ object: r.object, status: r.plan.status === "change" ? "pending" : "skipped", message: r.plan.reason }));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.plan.status !== "change") continue;
    if (shouldStop()) {
      out[i] = { ...out[i], status: "skipped", message: "Stopped before writing." };
      onRow(i, out[i]);
      continue;
    }
    const start = performance.now();
    out[i] = { ...out[i], status: "writing" };
    onRow(i, out[i]);
    try {
      const { targets: pre } = extractTargets(await io.read(row.object));
      if (signature(pre) !== row.snapshot) {
        out[i] = { ...out[i], status: "changed", preWrite: pre, message: "Assignments changed after the preview — not written. Preview again." };
      } else {
        await io.write(row.object, row.plan.after);
        const { targets: back } = extractTargets(await io.read(row.object));
        const ok = signature(back) === signature(row.plan.after);
        out[i] = {
          ...out[i],
          status: ok ? "ok" : "verifyFailed",
          preWrite: pre,
          written: row.plan.after,
          readBack: back,
          message: ok ? undefined : "Intune accepted the write but the read-back differs from what was sent.",
        };
      }
    } catch (e) {
      out[i] = { ...out[i], status: "failed", message: errMessage(e) };
    }
    out[i].ms = Math.round(performance.now() - start);
    onRow(i, out[i]);
  }
  return out;
}

/** Backup downloaded before anything is written: every policy's assignments exactly as read for the preview. */
export function backupJson(rows: PreviewRow[], meta: Record<string, unknown>): string {
  return JSON.stringify(
    {
      kind: "IntuneScope assignment backup",
      ...meta,
      policies: rows
        .filter((r) => r.plan.status === "change")
        .map((r) => ({
          id: r.object.id,
          name: r.object.name,
          workload: r.object.workload,
          platform: r.object.platform,
          assignments: r.raw,
          restore: { method: "POST", path: `/beta${path(r.object)}/assign`, body: assignBody(r.plan.before) },
        })),
    },
    null,
    2,
  );
}

export function reportJson(rows: RunRow[], meta: Record<string, unknown>): string {
  return JSON.stringify(
    {
      kind: "IntuneScope execution report",
      ...meta,
      summary: Object.fromEntries(Object.keys(RUN_LABEL).map((k) => [k, rows.filter((r) => r.status === k).length])),
      policies: rows.map((r) => ({
        id: r.object.id,
        name: r.object.name,
        workload: r.object.workload,
        status: r.status,
        message: r.message,
        ms: r.ms,
        preWrite: r.preWrite,
        written: r.written,
        readBack: r.readBack,
      })),
    },
    null,
    2,
  );
}
