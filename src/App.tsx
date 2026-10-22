import { useCallback, useEffect, useState } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { isConfigured } from "./config";
import { initAuth, signIn, signOut } from "./lib/auth";
import { describeError } from "./lib/graph";
import { loadInventory } from "./lib/inventory";
import type { Inventory, WorkloadStatus } from "./lib/model";
import { getSessionInfo, type SessionInfo } from "./lib/session";
import { Explorer } from "./components/Explorer";
import { Landing } from "./components/Landing";
import { Loading } from "./components/Loading";
import { SiteFooter } from "./components/Shared";

type Phase = "init" | "signedOut" | "loading" | "ready";

export default function App() {
  const [phase, setPhase] = useState<Phase>("init");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [status, setStatus] = useState<WorkloadStatus[]>([]);
  const [inv, setInv] = useState<Inventory | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setInv(null);
    setStatus([]);
    try {
      setSession(await getSessionInfo());
      setInv(await loadInventory(setStatus));
    } catch (e) {
      setError(describeError(e));
      setPhase("signedOut");
    }
  }, []);

  useEffect(() => {
    if (!isConfigured()) return;
    initAuth()
      .then((account: AccountInfo | null) => (account ? load() : setPhase("signedOut")))
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("signedOut");
      });
  }, [load]);

  let body;
  if (!isConfigured()) {
    body = (
      <div className="app">
        <div className="card error-card">
          <h2>Not configured</h2>
          <p>
            Set <code>VITE_CLIENT_ID</code> to the application (client) ID of the IntuneScope Explorer app registration. See the README.
          </p>
        </div>
      </div>
    );
  } else if (phase === "init") {
    body = (
      <div className="app">
        <p className="muted pad">Starting…</p>
      </div>
    );
  } else if (phase === "signedOut") {
    body = <Landing onSignIn={() => signIn(true)} error={error} />;
  } else if (phase === "loading" || !inv || !session) {
    body = <Loading status={status} session={session} done={!!inv} onContinue={() => setPhase("ready")} onSignOut={signOut} />;
  } else {
    body = <Explorer inv={inv} session={session} onRefresh={load} onSignOut={signOut} />;
  }

  return (
    <div className="page">
      {body}
      <SiteFooter />
    </div>
  );
}
