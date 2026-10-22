# IntuneScope

**See every Intune assignment — and what a group or filter really drives.**

IntuneScope is a browser-only tool for Microsoft Intune administrators. Sign in, and it loads your tenant's policies, apps and scripts with their assignments, so you can:

- **Policies** — browse every object with its targets, assignment filters and filter mode, across all platforms.
- **Group lookup** — pick an Entra group and see every policy, app, script and remediation that includes or excludes it.
- **Filter lookup** — pick an assignment filter and see everything that uses it, in include or exclude mode.
- **Export** — Excel (`.xlsx`, with an *About* sheet) or CSV, one row per assignment.

Hosted at **https://intunescope.app**. No install, no PowerShell, no backend.

> **Status:** v0.x — *Explorer* (read-only). The *Editor* (bulk add / replace / remove assignments and filters) is planned for v1.0 and will use a **separate** app registration with write permission.

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

### Admin consent

These permissions require admin consent. A Global Administrator, Privileged Role Administrator or Cloud Application Administrator can approve the app for the whole tenant:

```
https://login.microsoftonline.com/organizations/adminconsent?client_id=<CLIENT_ID>
```

## Limits (by design)

- **Direct references only.** A group nested inside an assigned group is not resolved.
- **Not device-level resolution.** IntuneScope shows what targets a group or filter — not what a specific device ends up receiving.
- **Scope tags** silently reduce what Graph returns. Results are labelled accordingly; "0 references" is shown as *No references found in the workloads you can see*.

## Self-hosting

1. Create an app registration in Microsoft Entra: **Single-page application**, redirect URI = the exact URL you will host on (with trailing slash), plus `http://localhost:5173/` for development.
2. Add the delegated permissions above.
3. `cp .env.example .env.local` and set `VITE_CLIENT_ID`.
4. `npm install && npm run dev` — or `npm run build` and publish `dist/` over HTTPS.

For GitHub Pages: set repository variables `VITE_CLIENT_ID` and (for a custom domain) `PAGES_DOMAIN`, enable Pages with source **GitHub Actions**, and push a `v*` tag.

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
