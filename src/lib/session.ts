import { GRAPH_V1 } from "../config";
import { msal } from "./auth";
import { graph } from "./graph";

export interface SessionInfo {
  tenantId: string;
  tenantName: string;
  defaultDomain: string;
  user: string;
}

export async function getSessionInfo(): Promise<SessionInfo> {
  const account = msal.getActiveAccount();
  const r = await graph<{ value: { id: string; displayName: string; verifiedDomains?: { name: string; isDefault: boolean }[] }[] }>(
    `${GRAPH_V1}/organization?$select=id,displayName,verifiedDomains`,
  );
  const org = r.value?.[0];
  return {
    tenantId: org?.id ?? account?.tenantId ?? "",
    tenantName: org?.displayName ?? "Unknown tenant",
    defaultDomain: org?.verifiedDomains?.find((d) => d.isDefault)?.name ?? "",
    user: account?.username ?? "",
  };
}
