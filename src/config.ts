// Public client configuration. There are no secrets in this app.
export const CLIENT_ID: string = import.meta.env.VITE_CLIENT_ID ?? "";
export const REDIRECT_URI: string = import.meta.env.VITE_REDIRECT_URI ?? `${window.location.origin}${import.meta.env.BASE_URL}`;

/**
 * Delegated Microsoft Graph scopes for the Explorer (read-only) registration.
 * All read-only. See "Permissions" in the README for why each one is needed.
 */
export const GRAPH_SCOPES = [
  "https://graph.microsoft.com/DeviceManagementConfiguration.Read.All", // configuration, compliance, endpoint security, filters, update profiles, ADMX
  "https://graph.microsoft.com/DeviceManagementApps.Read.All", // apps + app assignments
  "https://graph.microsoft.com/DeviceManagementScripts.Read.All", // platform scripts, shell scripts, remediations
  "https://graph.microsoft.com/Group.ReadBasic.All", // resolve group IDs to display names, group search
  "https://graph.microsoft.com/GroupMember.Read.All", // parent groups (transitiveMemberOf) for Group lookup
  "https://graph.microsoft.com/User.Read", // signed-in user + tenant name
];

/**
 * IntuneScope Editor registration (read/write). A separate enterprise app so tenants can approve
 * read-only Explorer without ever granting write. Empty = Editor disabled.
 */
export const EDITOR_CLIENT_ID: string = import.meta.env.VITE_EDITOR_CLIENT_ID ?? "";

/**
 * Delegated scopes requested at Editor sign-in. GroupMember.Read.All is required (v0.1.9): signed-in users without it
 * are sent through consent again. The Editor registration ALSO lists DeviceManagementApps.Read.All and DeviceManagementScripts.Read.All
 * (granted through admin consent). Entra puts every granted permission in the token, so tenants that
 * re-approved get apps/scripts read-only, and tenants that didn't can still sign in (those workloads show as skipped).
 */
export const EDITOR_SCOPES = [
  "https://graph.microsoft.com/DeviceManagementConfiguration.ReadWrite.All", // read + write policy assignments, filters
  "https://graph.microsoft.com/Group.ReadBasic.All", // group names and search
  "https://graph.microsoft.com/GroupMember.Read.All", // parent groups (transitiveMemberOf) for Group lookup
  "https://graph.microsoft.com/User.Read",
];

export const GRAPH_BETA = "https://graph.microsoft.com/beta";
export const GRAPH_V1 = "https://graph.microsoft.com/v1.0";

export const REPO_URL = "https://github.com/Simsen/IntuneScope";

const validId = (id: string) => /^[0-9a-f-]{36}$/i.test(id) && !/^0{8}-/.test(id);
export const isConfigured = (): boolean => validId(CLIENT_ID);
export const isEditorConfigured = (): boolean => validId(EDITOR_CLIENT_ID);
