import { useCallback, useEffect, useState } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { isConfigured } from "./config";
import { initAuth, signIn, signOut } from "./lib/auth";
import { DEMO_SESSION, loadDemoInventory, searchDemoGroups } from "./lib/demo";
import { describeError } from "./lib/graph";
import { loadInventory, searchGroups } from "./lib/inventory";
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
  const [demo, setDemo] = useState(false);

  const load = useCallback(async () => {
    setDemo(false);
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

  /** Demo mode: fictional Contoso tenant, no sign-in, no Graph calls. */
  const startDemo = useCallback(async () => {
    setDemo(true);
    setError(null);
    setPhase("loading");
    setInv(null);
    setStatus([]);
    setSession(DEMO_SESSION);
    setInv(await loadDemoInventory(setStatus));
  }, []);

  const exitDemo = useCallback(() => {
    setDemo(false);
    setInv(null);
    setSession(null);
    setStatus([]);
    setPhase("signedOut");
  }, []);

  useEffect(() => {
    if (!isConfigured()) {
      setPhase("signedOut");
      return;
    }
    initAuth()
      .then((account: AccountInfo | null) => (account ? load() : setPhase("signedOut")))
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("signedOut");
      });
  }, [load]);

  let body;
  if (phase === "init") {
    body = (
      <div className="app">
        <p className="muted pad">Starting…</p>
      </div>
    );
  } else if (phase === "signedOut") {
    body = (
      <Landing
        onSignIn={() => signIn(true)}
        onDemo={startDemo}
        canSignIn={isConfigured()}
        error={error}
      />
    );
  } else if (phase === "loading" || !inv || !session) {
    body = (
      <Loading
        status={status}
        session={session}
        done={!!inv}
        demo={demo}
        onContinue={() => setPhase("ready")}
        onSignOut={demo ? exitDemo : signOut}
      />
    );
  } else {
    body = (
      <Explorer
        inv={inv}
        session={session}
        demo={demo}
        searchGroups={demo ? searchDemoGroups : searchGroups}
        onRefresh={demo ? startDemo : load}
        onSignOut={demo ? exitDemo : signOut}
      />
    );
  }

  return (
    <div className="page">
      {body}
      <SiteFooter />
    </div>
  );
}
