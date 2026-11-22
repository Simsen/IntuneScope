import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";
import { CLIENT_ID, EDITOR_CLIENT_ID, EDITOR_SCOPES, GRAPH_SCOPES, REDIRECT_URI } from "../config";

/**
 * Two registrations behind one app: Explorer (read-only) and Editor (read/write).
 * The chosen mode survives the sign-in redirect in sessionStorage, so the right MSAL instance
 * completes the redirect. Switching mode always means a fresh sign-in against the other registration.
 */
export type Mode = "explorer" | "editor";
const MODE_KEY = "intunescope-mode";

export function currentMode(): Mode {
  try {
    return sessionStorage.getItem(MODE_KEY) === "editor" ? "editor" : "explorer";
  } catch {
    return "explorer";
  }
}

function setMode(mode: Mode) {
  try {
    if (mode === "editor") sessionStorage.setItem(MODE_KEY, "editor");
    else sessionStorage.removeItem(MODE_KEY);
  } catch {
    /* storage blocked: Explorer only */
  }
}

const scopesFor = (mode: Mode) => (mode === "editor" ? EDITOR_SCOPES : GRAPH_SCOPES);

const instances = new Map<Mode, PublicClientApplication>();
function pca(mode: Mode): PublicClientApplication {
  let p = instances.get(mode);
  if (!p) {
    // Authorization code + PKCE, multitenant ("organizations"). Redirect flow — popups are unreliable on mobile.
    p = new PublicClientApplication({
      auth: {
        clientId: mode === "editor" ? EDITOR_CLIENT_ID : CLIENT_ID,
        authority: "https://login.microsoftonline.com/organizations",
        redirectUri: REDIRECT_URI,
        postLogoutRedirectUri: REDIRECT_URI,
      },
      // Editor tokens can write: keep them to this tab only.
      cache: { cacheLocation: mode === "editor" ? "sessionStorage" : "localStorage" },
    });
    instances.set(mode, p);
  }
  return p;
}

/** The MSAL instance for the active mode. */
export const msal = {
  getActiveAccount: () => pca(currentMode()).getActiveAccount(),
};

let ready: Promise<AccountInfo | null> | null = null;

/** Initialise MSAL for the active mode and complete any pending redirect. Resolves the active account, if any. */
export function initAuth(): Promise<AccountInfo | null> {
  ready ??= (async () => {
    const p = pca(currentMode());
    await p.initialize();
    const result = await p.handleRedirectPromise();
    if (result?.account) p.setActiveAccount(result.account);
    const account = p.getActiveAccount() ?? p.getAllAccounts()[0] ?? null;
    if (account) p.setActiveAccount(account);
    return account;
  })();
  return ready;
}

/** Sign in to the given mode's registration. `selectAccount` forces the account picker (switch tenant/account). */
export async function signIn(mode: Mode = "explorer", selectAccount = false): Promise<void> {
  setMode(mode);
  const p = pca(mode);
  await p.initialize();
  await p.loginRedirect({ scopes: scopesFor(mode), prompt: selectAccount ? "select_account" : undefined });
}

export async function signOut(): Promise<void> {
  const mode = currentMode();
  const p = pca(mode);
  const account = p.getActiveAccount();
  setMode("explorer");
  await p.logoutRedirect({ account: account ?? undefined });
}

/** Access token for Graph. Falls back to an interactive redirect when consent/MFA/CA requires it. */
export async function getToken(): Promise<string> {
  const mode = currentMode();
  const p = pca(mode);
  const account = p.getActiveAccount();
  if (!account) throw new Error("Not signed in.");
  try {
    const r = await p.acquireTokenSilent({ scopes: scopesFor(mode), account });
    return r.accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) {
      await p.acquireTokenRedirect({ scopes: scopesFor(mode), account });
      // Navigation happens; this promise never resolves meaningfully.
      return new Promise(() => {});
    }
    throw e;
  }
}
