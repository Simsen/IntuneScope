# IntuneScope

**See every Intune assignment — and what a group or filter really drives.**

IntuneScope is a browser-only tool for Microsoft Intune administrators. Sign in, and it loads your tenant's policies, apps and scripts with their assignments, so you can:

- **Policies** — browse every object with its targets, assignment filters and filter mode, across all platforms.
- **Group lookup** — pick an Entra group and see every policy, app, script and remediation that includes or excludes it.
- **Filter lookup** — pick an assignment filter and see everything that uses it, in include or exclude mode.
- **Export** — Excel (`.xlsx`, with an *About* sheet) or CSV, one row per assignment.
- **Bulk edit** *(Editor)* — add, replace, remove assignments or change filters across many policies: preview → JSON backup → apply → verify.

Hosted at **https://intunescope.app**. No install, no PowerShell, no backend.

> **Two modes, two app registrations.** *Explorer* is read-only. *Editor* uses a **separate** app registration with write permission, so a tenant can approve Explorer without ever granting write — and can restrict Editor with *assignment required* and Conditional Access. Try both in the demo (Contoso sample tenant, no sign-in).

## How it works

| | |
|---|---|
| **Architecture** | Static single-page app (React + TypeScript + Vite). Your browser talks directly to Microsoft Graph. |
| **Sign-in** | Microsoft Entra, multitenant, MSAL.js with authorization code + PKCE. No client secret. |
| **Data** | Held in memory only. Closing or refreshing the tab discards it. No analytics, no telemetry. |
| **Hosting** | GitHub Pages, deployed only from version tags. Strict Content-Security-Policy. |

## Permissions

IntuneScope Explorer requests **delegated, read-only** Microsoft Graph permissions:

| Permission | Why |
|---|---|
| `DeviceManagementConfiguration.Read.All` | Settings catalog, endpoint security, device configuration, compliance, update profiles, ADMX, assignment filters |
| `DeviceManagementApps.Read.All` | Apps and app assignments |
| `DeviceManagementScripts.Read.All` | Platform scripts, macOS shell scripts, remediations |
| `Group.ReadBasic.All` | Resolve group IDs to names and search groups — basic properties only, no membership |
| `User.Read` | Signed-in user and tenant name |

Delegated permissions never exceed the signed-in user's own rights: **Intune RBAC and scope tags still apply.** If your role can't see an object, IntuneScope can't either — and every lookup says which workloads were and weren't searched.

IntuneScope **Editor** requests:

| Permission | Why |
|---|---|
| `DeviceManagementConfiguration.ReadWrite.All` | Read and change **assignments** of Settings Catalog, Endpoint Security, Device configuration and Compliance policies |
| `Group.ReadBasic.All` | Group names and search |
| `User.Read` | Signed-in user and tenant name |

Editor never changes policy settings, apps or scripts. Apps, scripts and remediations are not loaded in Editor mode (no consent for them); Autopilot, security baselines and other templates are shown read-only.

### How Editor writes

1. **One platform per batch.** Assignment filters are platform-specific and Graph does not validate the pairing, so IntuneScope enforces it.
2. **Preview from a fresh read** — before / after per policy. Filters are never placed on exclusions (Graph accepts that for some policy types).
3. **JSON backup downloads first**, with a ready-to-POST restore body per policy.
4. **Compare-and-skip:** each policy is re-read immediately before writing; if it changed since the preview it is *not* written.
5. **Verify:** read back after writing and compare. Results: Succeeded / Failed / Skipped / Changed since preview / Verification failed — plus a downloadable execution report.

Runs are not atomic: policies that succeeded stay changed even if others fail. Policies with assignments from a policy set are not edited.

### Admin consent

These permissions require admin consent. A Global Administrator, Privileged Role Administrator or Cloud Application Administrator can approve the app for the whole tenant:

```
Explorer: https://login.microsoftonline.com/organizations/adminconsent?client_id=<CLIENT_ID>
Editor:   https://login.microsoftonline.com/organizations/adminconsent?client_id=<EDITOR_CLIENT_ID>
```

## Limits (by design)

- **Direct references only.** A group nested inside an assigned group is not resolved.
- **Not device-level resolution.** IntuneScope shows what targets a group or filter — not what a specific device ends up receiving.
- **Scope tags** silently reduce what Graph returns. Results are labelled accordingly; "0 references" is shown as *No references found in the workloads you can see*.

## Self-hosting

1. Create an app registration in Microsoft Entra: **Single-page application**, redirect URI = the exact URL you will host on (with trailing slash), plus `http://localhost:5173/` for development.
2. Add the delegated permissions above.
3. Optional Editor: a second registration with the Editor permissions and the same redirect URIs.
4. `cp .env.example .env.local` and set `VITE_CLIENT_ID` (and `VITE_EDITOR_CLIENT_ID` for Editor).
5. `npm install && npm run dev` — or `npm run build` and publish `dist/` over HTTPS.

For GitHub Pages: set repository variables `VITE_CLIENT_ID`, `VITE_EDITOR_CLIENT_ID` (optional) and (for a custom domain) `PAGES_DOMAIN`, enable Pages with source **GitHub Actions**, and push a `v*` tag.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run typecheck
npm run build
```

## License

MIT — see [LICENSE](LICENSE). IntuneScope is not affiliated with or endorsed by Microsoft.
