import { CLIENT_ID } from "../config";
import { GitHubLink } from "./Shared";

// Grants the app's statically configured (read-only) permissions for the whole tenant.
const consentUrl = `https://login.microsoftonline.com/organizations/adminconsent?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
  window.location.origin + "/",
)}`;

const STEPS = [
  ["Policies", "Every policy with its targets, filters and filter mode — across all platforms."],
  ["Group lookup", "Pick an Entra group and see every policy, app and script that references it."],
  ["Filter lookup", "Pick an assignment filter and see where it is used, in include or exclude mode."],
  ["Export", "Excel or CSV, one row per assignment — ready to filter and pivot."],
];

export function Landing({ onSignIn, error }: { onSignIn: () => void; error?: string | null }) {
  return (
    <div className="app wide">
      <header className="top">
        <div className="top-row">
          <span className="brand">
            IntuneScope<span className="muted">.app</span>
          </span>
          <GitHubLink />
        </div>
      </header>

      <div className="landing">
        <section className="hero">
          <h1 className="hero-title">See every Intune assignment — and what a group or filter really drives</h1>
          <p className="lead">
            Browse policies, look up any Entra group or assignment filter, and export the result — straight from your browser. No PowerShell,
            no install.
          </p>
          {error && (
            <div className="card error-card">
              <h2>Sign-in failed</h2>
              <p className="small">{error}</p>
            </div>
          )}
          <div className="signin">
            <button className="btn" onClick={onSignIn}>
              Sign in with Microsoft — Explorer
            </button>
            <button className="btn secondary soon" disabled title="The Editor (bulk changes) ships in v1.0">
              Sign in as Editor <span className="tag warn">v1.0</span>
            </button>
          </div>
          <p className="note muted small">
            Runs entirely in your browser — tokens and tenant data go only to Microsoft. Explorer requests read-only permissions.
          </p>
        </section>

        <section>
          <h2 className="section-title">What you can do</h2>
          <ol className="step-grid four">
            {STEPS.map(([t, d], i) => (
              <li className="step" key={t}>
                <span className="step-num">{i + 1}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="faq">
          <h2 className="section-title">Before you start</h2>
          <details>
            <summary>Requirements</summary>
            <div className="faq-body">
              <ul>
                <li>A Microsoft Entra work account with an Intune role that can read the objects you want to see (e.g. Read Only Operator).</li>
                <li>Admin consent for IntuneScope Explorer in your tenant — asked on first sign-in.</li>
                <li>A modern browser. Nothing is installed.</li>
              </ul>
            </div>
          </details>
          <details>
            <summary>Permissions</summary>
            <div className="faq-body">
              <p>Explorer uses delegated, read-only Microsoft Graph permissions:</p>
              <ul>
                <li>
                  <code>DeviceManagementConfiguration.Read.All</code> — configuration, compliance, endpoint security, update profiles, filters
                </li>
                <li>
                  <code>DeviceManagementApps.Read.All</code> — apps and their assignments
                </li>
                <li>
                  <code>DeviceManagementScripts.Read.All</code> — platform scripts, shell scripts, remediations
                </li>
                <li>
                  <code>Group.ReadBasic.All</code> — group names only (no members)
                </li>
                <li>
                  <code>User.Read</code> — who signed in, and the tenant name
                </li>
              </ul>
              <p>
                Delegated permissions never exceed your own Intune role. Admins can pre-approve the app with the{" "}
                <a href={consentUrl}>admin consent link</a>.
              </p>
            </div>
          </details>
          <details>
            <summary>Privacy &amp; security</summary>
            <div className="faq-body">
              <ul>
                <li>No backend. The app is static files; your browser talks directly to Microsoft.</li>
                <li>Tenant data is held in memory only and is gone when you close the tab.</li>
                <li>No analytics, no telemetry, no secrets. Open source (MIT).</li>
              </ul>
            </div>
          </details>
          <details>
            <summary>Troubleshooting</summary>
            <div className="faq-body">
              <ul>
                <li>
                  <strong>Need admin approval</strong> — ask a Global/Privileged Role/Cloud Application Administrator to use the admin consent link.
                </li>
                <li>
                  <strong>Some workloads show 403</strong> — your Intune role can't read that workload. IntuneScope tells you what it could not search.
                </li>
                <li>
                  <strong>Fewer objects than expected</strong> — scope tags limit what your role can see.
                </li>
              </ul>
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
