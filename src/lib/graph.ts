import { GRAPH_BETA } from "../config";
import { getToken } from "./auth";

/** Thin Microsoft Graph client: auth header, paging, throttling, $batch. Read-only in v0.x. */

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = (path: string) => (path.startsWith("https://") ? path : `${GRAPH_BETA}${path}`);

/** GET/POST with retry on 429 and transient 5xx (all calls in v0.x are reads, so retrying is safe). */
export async function graph<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const token = await getToken();
  const res = await fetch(url(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const transient = res.status === 429 || res.status === 503 || res.status === 504;
  if (transient && attempt < 4) {
    const wait = Number(res.headers.get("Retry-After")) || 2 ** attempt * 2;
    await sleep(Math.min(wait, 30) * 1000);
    return graph<T>(path, init, attempt + 1);
  }

  if (!res.ok) {
    let code = `HTTP${res.status}`;
    let message = res.statusText;
    let requestId = res.headers.get("request-id") ?? undefined;
    try {
      const body = await res.json();
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
      requestId = body?.error?.innerError?.["request-id"] ?? requestId;
    } catch {
      /* non-JSON error body */
    }
    throw new GraphError(message, res.status, code, requestId);
  }
  if (res.status === 204) return undefined as T;
  // Intune's /assign answers 200 with an EMPTY body (verified 2026-10-23) — that is success, not a parse error.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

interface Page<T> {
  value: T[];
  "@odata.nextLink"?: string;
}

/** Follow @odata.nextLink until exhausted. `onPage` reports progress. */
export async function getAll<T>(path: string, onPage?: (count: number) => void): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: Page<T> = await graph<Page<T>>(next);
    out.push(...(page.value ?? []));
    onPage?.(out.length);
    next = page["@odata.nextLink"];
  }
  return out;
}

interface BatchResponse {
  responses: { id: string; status: number; body?: unknown; headers?: Record<string, string> }[];
}

/**
 * GET many relative URLs through JSON $batch (20 per request). Returns a map id → body.
 * Individual 429s inside a batch are retried once after their Retry-After.
 */
export async function batchGet<T>(paths: string[], onProgress?: (done: number) => void): Promise<Map<number, T | GraphError>> {
  const result = new Map<number, T | GraphError>();
  for (let i = 0; i < paths.length; i += 20) {
    let pending = paths.slice(i, i + 20).map((p, j) => ({ id: String(i + j), method: "GET", url: p }));
    for (let attempt = 0; pending.length && attempt < 4; attempt++) {
      const r = await graph<BatchResponse>("/$batch", { method: "POST", body: JSON.stringify({ requests: pending }) });
      const retry: typeof pending = [];
      let wait = 0;
      for (const resp of r.responses) {
        const idx = Number(resp.id);
        if (resp.status === 429 || resp.status === 503) {
          retry.push(pending.find((p) => p.id === resp.id)!);
          wait = Math.max(wait, Number(resp.headers?.["Retry-After"]) || 2 ** attempt * 2);
        } else if (resp.status >= 400) {
          const err = (resp.body as { error?: { message?: string; code?: string } })?.error;
          result.set(idx, new GraphError(err?.message ?? `HTTP ${resp.status}`, resp.status, err?.code ?? `HTTP${resp.status}`));
        } else {
          result.set(idx, resp.body as T);
        }
      }
      pending = retry;
      if (pending.length) await sleep(Math.min(wait, 30) * 1000);
    }
    for (const p of pending) result.set(Number(p.id), new GraphError("Throttled", 429, "TooManyRequests"));
    onProgress?.(Math.min(i + 20, paths.length));
  }
  return result;
}

export function describeError(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.status === 401 || e.status === 403) return `${e.status} — no read access`;
    if (e.status === 429) return "throttled";
    return `${e.status || "error"} — ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
