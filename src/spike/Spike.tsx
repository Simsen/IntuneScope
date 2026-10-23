/**
 * TEMPORARY write spike for Editor v1.0 — removed after the test.
 *
 * Signs in with the separate "IntuneScope Editor" registration and verifies Graph write behaviour
 * on policies that are UNASSIGNED at start. Each write is followed by read-back, and every policy is
 * restored to its original (empty) assignment set. Nothing assigned is ever touched.
 */
import { PublicClientApplication, InteractionRequiredAuthError, type AccountInfo } from "@azure/msal-browser";
import { useEffect, useMemo, useRef, useState } from "react";

const EDITOR_CLIENT_ID = "67b92e7c-054d-4794-8be3-5949a061e5ff";
const SCOPES = [
  "https://graph.microsoft.com/DeviceManagementConfiguration.ReadWrite.All",
  "https://graph.microsoft.com/Group.ReadBasic.All",
];
const BETA = "https://graph.microsoft.com/beta";
const V1 = "https://graph.microsoft.com/v1.0";
export const SPIKE_FLAG = "intunescope-spike";

const pca = new PublicClientApplication({
  auth: {
    clientId: EDITOR_CLIENT_ID,
    authority: "https://login.microsoftonline.com/organizations",
    redirectUri: `${window.location.origin}/`,
  },
  cache: { cacheLocation: "sessionStorage" },
});

type Raw = Record<string, any>;
type Log = { t: number; level: "info" | "ok" | "warn" | "err"; msg: string; data?: unknown };
type Kind = "configurationPolicies" | "deviceConfigurations" | "deviceCompliancePolicies";
type Candidate = { kind: Kind; id: string; name: string; detail: string };
type Result = { test: string; kind: Kind | "-"; policy: string; outcome: "pass" | "fail" | "info"; note: string; ms?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function token(account: AccountInfo): Promise<string> {
  try {
    return (await pca.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) await pca.acquireTokenRedirect({ scopes: SCOPES, account });
    throw e;
  }
}

/** Normalised, order-independent signature of an assignment set. */
function sig(assignments: Raw[]): string {
  return JSON.stringify(
    assignments
      .map((a) => {
        const t = a.target ?? {};
        const fType = t.deviceAndAppManagementAssignmentFilterType;
        const fId = t.deviceAndAppManagementAssignmentFilterId;
        const hasFilter = fId && !/^0{8}-/.test(fId) && fType && fType !== "none";
        return [String(t["@odata.type"] ?? "").replace("#microsoft.graph.", ""), t.groupId ?? "", hasFilter ? fId : "", hasFilter ? fType : ""].join("|");
      })
      .sort(),
  );
}

function target(type: "group" | "exclusion", groupId: string, filter?: { id: string; mode: "include" | "exclude" }): Raw {
  return {
    "@odata.type": type === "group" ? "#microsoft.graph.groupAssignmentTarget" : "#microsoft.graph.exclusionGroupAssignmentTarget",
    groupId,
    ...(filter
      ? { deviceAndAppManagementAssignmentFilterId: filter.id, deviceAndAppManagementAssignmentFilterType: filter.mode }
      : {}),
  };
}

export default function Spike() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [logs, setLogs] = useState<Log[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [plan, setPlan] = useState<{ candidates: Candidate[]; group: Raw; filter: Raw | null } | null>(null);
  const [includeTest, setIncludeTest] = useState(false);
  const [manualGroupId, setManualGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const t0 = useRef(Date.now());

  const log = (level: Log["level"], msg: string, data?: unknown) =>
    setLogs((l) => [...l, { t: Date.now() - t0.current, level, msg, data }]);
  const result = (r: Result) => setResults((x) => [...x, r]);

  useEffect(() => {
    (async () => {
      await pca.initialize();
      const r = await pca.handleRedirectPromise();
      const acc = r?.account ?? pca.getAllAccounts()[0] ?? null;
      if (acc) pca.setActiveAccount(acc);
      setAccount(acc);
      setReady(true);
    })().catch((e) => {
      log("err", `Sign-in failed: ${e?.message ?? e}`);
      setReady(true);
    });
  }, []);

  async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any; ms: number }> {
    const tok = await token(account!);
    const start = performance.now();
    const res = await fetch(path.startsWith("https://") ? path : BETA + path, {
      method,
      headers: { Authorization: `Bearer ${tok}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ms = Math.round(performance.now() - start);
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (res.status === 429) log("warn", `429 throttled on ${method} ${path} (Retry-After ${res.headers.get("Retry-After")})`);
    else if (res.status >= 400)
      log("err", `${method} ${path} → ${res.status} ${json?.error?.code ?? ""}: ${json?.error?.message ?? text.slice(0, 300)} (request-id ${res.headers.get("request-id") ?? "?"})`);
    return { status: res.status, json, ms };
  }

  const readAssignments = async (c: Candidate): Promise<Raw[]> => {
    const r = await call("GET", `/deviceManagement/${c.kind}/${c.id}/assignments`);
    if (r.status !== 200) throw new Error(`read assignments ${r.status}: ${JSON.stringify(r.json?.error ?? r.json)}`);
    return r.json.value ?? [];
  };

  /** Poll until assignments match `want`; returns ms until match or -1. */
  async function readBack(c: Candidate, want: Raw[]): Promise<{ ms: number; got: Raw[] }> {
    const start = performance.now();
    let got: Raw[] = [];
    for (const wait of [0, 500, 1000, 2000, 4000, 8000]) {
      await sleep(wait);
      got = await readAssignments(c);
      if (sig(got) === sig(want.map((t) => ({ target: t })))) return { ms: Math.round(performance.now() - start), got };
    }
    return { ms: -1, got };
  }

  async function findPlan() {
    setBusy(true);
    setPlan(null);
    setResults([]);
    try {
      log("info", "Finding UNASSIGNED candidate policies (read-only)…");
      const candidates: Candidate[] = [];

      const cp = await call("GET", "/deviceManagement/configurationPolicies?$select=id,name,platforms,templateReference&$top=100");
      const cpList: Raw[] = cp.json?.value ?? [];
      const pick = async (list: Raw[], kind: Kind, pred: (r: Raw) => boolean, label: string) => {
        for (const r of list.filter(pred)) {
          const c: Candidate = { kind, id: r.id, name: r.name ?? r.displayName, detail: label };
          if ((await readAssignments(c)).length === 0) {
            candidates.push(c);
            return;
          }
        }
        log("warn", `No unassigned ${label} found — that type is skipped.`);
      };
      await pick(cpList, "configurationPolicies", (r) => (r.templateReference?.templateFamily ?? "none") === "none" && /windows/i.test(r.platforms ?? ""), "Settings Catalog (Windows)");
      await pick(cpList, "configurationPolicies", (r) => String(r.templateReference?.templateFamily ?? "").startsWith("endpointSecurity"), "Endpoint security");
      const dc = await call("GET", "/deviceManagement/deviceConfigurations?$select=id,displayName&$top=100");
      await pick(dc.json?.value ?? [], "deviceConfigurations", () => true, "Device configuration");
      const comp = await call("GET", "/deviceManagement/deviceCompliancePolicies?$select=id,displayName&$top=100");
      await pick(comp.json?.value ?? [], "deviceCompliancePolicies", () => true, "Compliance");

      let group: Raw | undefined;
      const manual = manualGroupId.trim();
      if (manual) {
        const g = await call("GET", `/groups/${encodeURIComponent(manual)}?$select=id,displayName`);
        group = g.status === 200 ? g.json : { id: manual, displayName: `(name not readable) ${manual}` };
      } else {
        const g = await call("GET", "/groups?$select=id,displayName&$top=5");
        group = g.json?.value?.[0];
        if (!group) {
          const g2 = await call("GET", `${V1}/groups?$select=id,displayName&$top=5`);
          group = g2.json?.value?.[0];
        }
      }
      if (!group) throw new Error("No group readable — paste a group object ID below and run step 1 again (see the error lines above for Graph's reason).");
      const f = await call("GET", "/deviceManagement/assignmentFilters?$select=id,displayName,platform");
      const filter = (f.json?.value ?? []).find((x: Raw) => x.platform === "windows10AndLater") ?? null;

      setPlan({ candidates, group, filter });
      log("ok", `Plan ready: ${candidates.length} unassigned policies, group "${group.displayName}", filter ${filter ? `"${filter.displayName}"` : "(none for Windows)"}.`);
    } catch (e: any) {
      log("err", e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!plan) return;
    setBusy(true);
    setResults([]);
    const { candidates, group, filter } = plan;
    const restore: Candidate[] = [];
    try {
      for (const c of candidates) {
        const label = `${c.detail}: ${c.name}`;
        // Compare-and-skip in miniature: re-read before writing.
        const before = await readAssignments(c);
        if (before.length) {
          result({ test: "pre-check", kind: c.kind, policy: c.name, outcome: "info", note: "Got an assignment since planning — skipped, nothing written." });
          continue;
        }
        restore.push(c);

        // T1: exclusion-only write (deploys nothing on an unassigned policy).
        const t1 = [target("exclusion", group.id)];
        let w = await call("POST", `/deviceManagement/${c.kind}/${c.id}/assign`, { assignments: t1.map((t) => ({ target: t })) });
        log(w.status < 300 ? "ok" : "err", `T1 assign exclusion → ${w.status} (${w.ms} ms) on ${label}`, w.json);
        if (w.status < 300) {
          const rb = await readBack(c, t1);
          result({ test: "T1 exclusion write + read-back", kind: c.kind, policy: c.name, outcome: rb.ms >= 0 ? "pass" : "fail", note: rb.ms >= 0 ? `visible after ${rb.ms} ms` : `not visible after 15 s: ${sig(rb.got)}`, ms: w.ms });
        } else {
          result({ test: "T1 exclusion write", kind: c.kind, policy: c.name, outcome: "fail", note: `${w.status} ${JSON.stringify(w.json?.error?.message ?? w.json)}` });
        }

        // T3: filter on an exclusion assignment (also proves replace semantics: T1's entry must be gone afterwards).
        if (filter) {
          const t3 = [target("exclusion", group.id, { id: filter.id, mode: "include" })];
          w = await call("POST", `/deviceManagement/${c.kind}/${c.id}/assign`, { assignments: t3.map((t) => ({ target: t })) });
          const after = await readAssignments(c);
          const stored = after[0]?.target ?? {};
          const filterKept = stored.deviceAndAppManagementAssignmentFilterId === filter.id && stored.deviceAndAppManagementAssignmentFilterType !== "none";
          result({
            test: "T3 filter on exclusion",
            kind: c.kind,
            policy: c.name,
            outcome: "info",
            note: w.status >= 300 ? `rejected ${w.status}: ${w.json?.error?.message ?? ""}` : filterKept ? "ACCEPTED and stored (!)" : "accepted but filter dropped",
          });
          log("info", `T3 ${label}: status ${w.status}`, { response: w.json, stored });
        }

        // T4: restore to empty — does assign accept an empty collection, and does it clear everything?
        w = await call("POST", `/deviceManagement/${c.kind}/${c.id}/assign`, { assignments: [] });
        const rb4 = await readBack(c, []);
        result({ test: "T4 restore with empty set", kind: c.kind, policy: c.name, outcome: w.status < 300 && rb4.ms >= 0 ? "pass" : "fail", note: `${w.status}, ${rb4.ms >= 0 ? `empty after ${rb4.ms} ms` : `still ${sig(rb4.got)}`}` });
      }

      // T5 (opt-in): include + filter on the Windows Settings Catalog policy, reverted immediately.
      const sc = candidates.find((c) => c.detail === "Settings Catalog (Windows)");
      if (includeTest && sc && filter) {
        const t5 = [target("group", group.id, { id: filter.id, mode: "include" })];
        const w = await call("POST", `/deviceManagement/${sc.kind}/${sc.id}/assign`, { assignments: t5.map((t) => ({ target: t })) });
        const rb = w.status < 300 ? await readBack(sc, t5) : { ms: -1, got: [] };
        await call("POST", `/deviceManagement/${sc.kind}/${sc.id}/assign`, { assignments: [] });
        const back = await readBack(sc, []);
        result({ test: "T5 include + filter (reverted)", kind: sc.kind, policy: sc.name, outcome: w.status < 300 && rb.ms >= 0 && back.ms >= 0 ? "pass" : "fail", note: `write ${w.status}, visible ${rb.ms} ms, reverted ${back.ms >= 0 ? "OK" : "FAILED"}` });
      }
    } catch (e: any) {
      log("err", `Run aborted: ${e.message ?? e}`);
    } finally {
      // Safety net: make sure every touched policy is empty again.
      for (const c of restore) {
        try {
          const now = await readAssignments(c);
          if (now.length) {
            await call("POST", `/deviceManagement/${c.kind}/${c.id}/assign`, { assignments: [] });
            log("warn", `Safety net cleared ${c.name}`);
          }
          const final = await readAssignments(c);
          result({ test: "Final state", kind: c.kind, policy: c.name, outcome: final.length === 0 ? "pass" : "fail", note: final.length === 0 ? "unassigned (as before)" : `STILL ASSIGNED: ${sig(final)}` });
        } catch (e: any) {
          result({ test: "Final state", kind: c.kind, policy: c.name, outcome: "fail", note: `could not verify: ${e.message}` });
        }
      }
      setBusy(false);
    }
  }

  const report = useMemo(
    () => JSON.stringify({ at: new Date().toISOString(), tenant: account?.tenantId, plan, results, logs }, null, 2),
    [account, plan, results, logs],
  );

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([report], { type: "application/json" }));
    a.download = `intunescope-write-spike-${Date.now()}.json`;
    a.click();
  };

  const exit = () => {
    sessionStorage.removeItem(SPIKE_FLAG);
    window.location.href = "/";
  };

  if (!ready) return <div className="app"><p className="muted">Loading…</p></div>;

  return (
    <div className="app wide">
      <header className="top">
        <div className="top-row">
          <span className="brand">IntuneScope<span className="muted">.app</span></span>
          <span className="mode demo">Write spike · temporary</span>
        </div>
      </header>

      <div className="card warn">
        <strong>Internal test page.</strong> Uses the IntuneScope Editor registration (write access). Only policies that are unassigned at start are
        written to; every write is read back and the policy is restored to unassigned.
      </div>

      {!account ? (
        <div className="row">
          <button className="btn" onClick={() => pca.loginRedirect({ scopes: SCOPES, prompt: "select_account" })}>
            Sign in with IntuneScope Editor
          </button>
          <button className="btn secondary" onClick={exit}>Back to IntuneScope</button>
        </div>
      ) : (
        <>
          <p className="small">Signed in as <b>{account.username}</b> · tenant <code>{account.tenantId}</code></p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={findPlan}>1 · Find unassigned test policies (read-only)</button>
            <button className="btn secondary" onClick={exit}>Exit</button>
          </div>
          <label className="field small">
            Optional: group object ID to use as the exclusion target (only needed if automatic lookup fails)
            <input type="text" value={manualGroupId} onChange={(e) => setManualGroupId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </label>

          {plan && (
            <section className="card">
              <h2>Plan</h2>
              <ul className="small">
                {plan.candidates.map((c) => (
                  <li key={c.id}><b>{c.detail}</b> — {c.name} <span className="muted">({c.id})</span></li>
                ))}
                <li>Exclusion group: <b>{plan.group.displayName}</b></li>
                <li>Windows filter: <b>{plan.filter?.displayName ?? "none — filter tests skipped"}</b></li>
              </ul>
              <label className="small">
                <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Also run T5: <b>include</b> assignment
                + filter on the Settings Catalog policy above, reverted within seconds (can briefly target real devices in that group).
              </label>
              <div className="row">
                <button className="btn" disabled={busy || !plan.candidates.length} onClick={run}>2 · Run write tests</button>
              </div>
            </section>
          )}

          {results.length > 0 && (
            <section className="card flush">
              <div className="table-wrap">
                <table className="grid">
                  <thead><tr><th>Test</th><th>Type</th><th>Policy</th><th>Outcome</th><th>Note</th></tr></thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td>{r.test}</td><td className="muted">{r.kind}</td><td className="strong">{r.policy}</td>
                        <td className={r.outcome === "pass" ? "writable" : r.outcome === "fail" ? "warn-inline" : "muted"}>{r.outcome}</td>
                        <td className="small">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {logs.length > 0 && (
            <>
              <div className="row"><button className="btn secondary" onClick={download}>Download report (.json)</button></div>
              <pre className="small" style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>
                {logs.map((l) => `${(l.t / 1000).toFixed(1)}s ${l.level.toUpperCase()} ${l.msg}`).join("\n")}
              </pre>
            </>
          )}
        </>
      )}
    </div>
  );
}
