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
  "https://graph.microsoft.com/User.Read", // signed-in user + tenant name
];

export const GRAPH_BETA = "https://graph.microsoft.com/beta";
export const GRAPH_V1 = "https://graph.microsoft.com/v1.0";

export const REPO_URL = "https://github.com/Simsen/IntuneScope";

export const isConfigured = (): boolean => /^[0-9a-f-]{36}$/i.test(CLIENT_ID) && !/^0{8}-/.test(CLIENT_ID);
