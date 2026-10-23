import type { Assignment, AssignmentFilter, GroupInfo, IntuneObject, Inventory, PlatformKey, WorkloadId, WorkloadStatus } from "./model";
import { filterPlatformLabel } from "./normalize";
import type { SessionInfo } from "./session";

/**
 * Demo mode: a fictional "Contoso" tenant with sample policies and assignments.
 * No sign-in, no Graph calls — everything here is static, made-up data.
 */

export const DEMO_SESSION: SessionInfo = {
  tenantId: "00000000-0000-4000-8000-00000000c0de",
  tenantName: "Contoso Ltd (demo)",
  defaultDomain: "contoso.onmicrosoft.com",
  user: "megan.bowen@contoso.com",
};

/** Deterministic, random-looking GUIDs for the sample data. */
const id = (n: number) => {
  let x = Math.imul(n, 2654435761) >>> 0 || 1;
  const next = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x.toString(16).padStart(8, "0");
  };
  const h = next() + next() + next() + next();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const GROUP_NAMES = [
  "SG-WIN-PILOT",
  "SG-WIN-PROD",
  "SG-WIN-VIP",
  "SG-WIN-KIOSK",
  "SG-MAC-PILOT",
  "SG-MAC-ALL",
  "SG-IOS-ALL",
  "SG-IOS-EXEC",
  "SG-AND-FIELD",
  "SG-IT-ADMINS",
  "SG-FINANCE",
  "SG-Intune-Licensed",
];
const G = Object.fromEntries(GROUP_NAMES.map((n, i) => [n, id(0x100 + i)])) as Record<string, string>;
const DELETED_A = id(0x1ff);
const DELETED_B = id(0x1fe);

const FILTER_DEFS: [string, string, string][] = [
  ["WIN-Corporate", "windows10AndLater", '(device.deviceOwnership -eq "Corporate")'],
  ["WIN-Personal", "windows10AndLater", '(device.deviceOwnership -eq "Personal")'],
  ["WIN-OldCorporate", "windows10AndLater", '(device.manufacturer -eq "Contoso") and (device.deviceOwnership -eq "Corporate")'],
  ["WIN-Kiosk", "windows10AndLater", '(device.enrollmentProfileName -eq "WIN-AP-Kiosk")'],
  ["MAC-Corporate", "macOS", '(device.deviceOwnership -eq "Corporate")'],
  ["iOS-Corporate", "iOS", '(device.deviceOwnership -eq "Corporate") and (device.model -startsWith "iPhone")'],
  ["AE-FullyManaged", "androidForWork", '(device.enrollmentProfileName -startsWith "AE-FM")'],
  ["AOSP-Rugged", "androidAOSP", '(device.manufacturer -eq "Zebra")'],
];
const F = Object.fromEntries(FILTER_DEFS.map(([n], i) => [n, id(0x200 + i)])) as Record<string, string>;

// Assignment helpers
const inc = (g: string, f?: string, mode: "include" | "exclude" = "include"): Assignment => ({
  targetKind: "group",
  groupId: G[g] ?? g,
  intent: "include",
  ...(f ? { filterId: F[f], filterMode: mode } : {}),
});
const exc = (g: string): Assignment => ({ targetKind: "group", groupId: G[g] ?? g, intent: "exclude" });
const allUsers = (f?: string, mode: "include" | "exclude" = "include"): Assignment => ({
  targetKind: "allUsers",
  intent: "include",
  ...(f ? { filterId: F[f], filterMode: mode } : {}),
});
const allDevices = (f?: string, mode: "include" | "exclude" = "include"): Assignment => ({
  targetKind: "allDevices",
  intent: "include",
  ...(f ? { filterId: F[f], filterMode: mode } : {}),
});
const app = (a: Assignment, intent: string): Assignment => ({ ...a, appIntent: intent });

let seq = 0x300;
const obj = (workload: WorkloadId, name: string, platform: PlatformKey, typeLabel: string, writable: boolean, assignments: Assignment[]): IntuneObject => {
  const oid = id(seq++);
  return { key: `${workload}:${oid}`, id: oid, name, workload, typeLabel, platform, writable, assignments };
};

function demoObjects(): IntuneObject[] {
  seq = 0x300;
  const sc = "configurationPolicies" as const;
  const dc = "deviceConfigurations" as const;
  const cp = "compliance" as const;
  return [
    // Settings catalog & endpoint security
    obj(sc, "WIN - Defender Antivirus", "windows", "Endpoint security · Antivirus", true, [inc("SG-WIN-PILOT", "WIN-Corporate"), exc("SG-WIN-VIP")]),
    obj(sc, "WIN - Defender Firewall", "windows", "Endpoint security · Firewall", true, [inc("SG-WIN-PILOT")]),
    obj(sc, "WIN - Attack Surface Reduction", "windows", "Endpoint security · Attack Surface Reduction", true, [allDevices("WIN-Corporate"), exc("SG-WIN-KIOSK")]),
    obj(sc, "WIN - BitLocker", "windows", "Endpoint security · Disk Encryption", true, [allDevices("WIN-Corporate")]),
    obj(sc, "WIN - Edge baseline", "windows", "Settings catalog", true, [inc("SG-WIN-PILOT", "WIN-Corporate"), inc("SG-IT-ADMINS")]),
    obj(sc, "WIN - OneDrive Known Folder Move", "windows", "Settings catalog", true, [allUsers("WIN-Personal", "exclude")]),
    obj(sc, "WIN - Windows Hello for Business", "windows", "Settings catalog", true, [inc("SG-WIN-PROD"), inc("SG-WIN-PILOT")]),
    obj(sc, "WIN - Security baseline 24H2", "windows", "Security baseline", true, [inc("SG-WIN-PILOT")]),
    obj(sc, "WIN - LAPS", "windows", "Endpoint security · Account Protection", true, [allDevices("WIN-Corporate")]),
    obj(sc, "MAC - FileVault", "macOS", "Endpoint security · Disk Encryption", true, [inc("SG-MAC-PILOT", "MAC-Corporate")]),
    obj(sc, "MAC - Platform SSO", "macOS", "Settings catalog", true, [inc("SG-MAC-ALL")]),
    obj(sc, "MAC - Restrictions", "macOS", "Settings catalog", true, []),
    obj(sc, "iOS - Restrictions", "ios", "Settings catalog", true, [allDevices("iOS-Corporate"), exc("SG-IOS-EXEC")]),
    obj(sc, "WIN - Legacy proxy settings", "windows", "Settings catalog", true, [inc(DELETED_A)]),
    // Device configuration
    obj(dc, "WIN - Update ring Pilot", "windows", "Device configuration · Update ring", true, [inc("SG-WIN-PILOT")]),
    obj(dc, "WIN - Update ring Broad", "windows", "Device configuration · Update ring", true, [allDevices("WIN-Corporate"), exc("SG-WIN-PILOT")]),
    obj(dc, "WIN - Wi-Fi Contoso-Corp", "windows", "Device configuration · Wi-Fi", true, [inc("SG-WIN-PROD"), exc("SG-WIN-KIOSK")]),
    obj(dc, "WIN - Kiosk lockdown", "windows", "Device configuration · Kiosk", true, []),
    obj(dc, "WIN - Custom OMA-URI (old)", "windows", "Device configuration · Custom (OMA-URI)", true, [inc(DELETED_B), inc("SG-WIN-PILOT")]),
    obj(dc, "iOS - Wi-Fi Contoso-Corp", "ios", "Device configuration · Wi-Fi", true, [inc("SG-IOS-ALL", "iOS-Corporate")]),
    obj(dc, "AND - Work profile restrictions", "androidEnterprise", "Device configuration · Device restrictions", true, [inc("SG-AND-FIELD", "AE-FullyManaged")]),
    // Compliance
    obj(cp, "WIN - Compliance baseline", "windows", "Compliance", true, [allUsers()]),
    obj(cp, "WIN - Compliance pilot", "windows", "Compliance", true, [inc("SG-WIN-PILOT")]),
    obj(cp, "MAC - Compliance", "macOS", "Compliance", true, [inc("SG-MAC-ALL")]),
    obj(cp, "iOS - Compliance", "ios", "Compliance", true, [inc("SG-IOS-ALL")]),
    obj(cp, "AND - Compliance", "androidEnterprise", "Compliance", true, [inc("SG-AND-FIELD")]),
    // Apps
    obj("apps", "Company Portal", "windows", "App · Microsoft Store", false, [app(allUsers(), "required")]),
    obj("apps", "Microsoft 365 Apps", "windows", "App · Microsoft 365 Apps", false, [app(inc("SG-Intune-Licensed"), "required"), app(exc("SG-WIN-KIOSK"), "required")]),
    obj("apps", "7-Zip", "windows", "App · Win32", false, [app(inc("SG-WIN-PILOT"), "available")]),
    obj("apps", "Contoso VPN Client", "windows", "App · Win32", false, [app(allDevices("WIN-Corporate"), "required")]),
    obj("apps", "Microsoft Teams", "macOS", "App · PKG", false, [app(inc("SG-MAC-ALL"), "required")]),
    obj("apps", "Microsoft Authenticator", "ios", "App · App Store", false, [app(inc("SG-IOS-ALL"), "required")]),
    obj("apps", "Microsoft Outlook", "androidEnterprise", "App · Managed Google Play", false, [app(inc("SG-AND-FIELD"), "required")]),
    // Shell scripts, remediations, updates, ADMX
    obj("platformScripts", "WIN - Set time zone", "windows", "Platform script", false, [inc("SG-WIN-PROD")]),
    obj("platformScripts", "WIN - Map network drives", "windows", "Platform script", false, [inc("SG-FINANCE")]),
    obj("shellScripts", "MAC - Set computer name", "macOS", "Shell script", false, [inc("SG-MAC-ALL")]),
    obj("remediations", "Fix-OneDriveSync", "windows", "Remediation", false, [inc("SG-WIN-PILOT", "WIN-Corporate")]),
    obj("remediations", "Clear-TeamsCache", "windows", "Remediation", false, [inc("SG-FINANCE")]),
    obj("featureUpdates", "WIN - Feature update 24H2", "windows", "Feature update", false, [inc("SG-WIN-PILOT"), inc("SG-WIN-PROD")]),
    obj("qualityUpdates", "WIN - Expedite quality update", "windows", "Quality update", false, [inc("SG-WIN-PROD")]),
    obj("driverUpdates", "WIN - Driver updates (manual approval)", "windows", "Driver update", false, [inc("SG-WIN-PROD")]),
    obj("admx", "WIN - Office ADMX", "windows", "Administrative template", false, [inc("SG-WIN-PILOT")]),
  ];
}

const LABELS: [WorkloadStatus["id"], string][] = [
  ["filters", "Assignment filters"],
  ["configurationPolicies", "Settings catalog & endpoint security"],
  ["deviceConfigurations", "Device configuration"],
  ["compliance", "Compliance"],
  ["apps", "Apps"],
  ["platformScripts", "Platform scripts (Windows)"],
  ["shellScripts", "Shell scripts (macOS)"],
  ["remediations", "Remediations"],
  ["featureUpdates", "Windows feature updates"],
  ["qualityUpdates", "Windows quality updates"],
  ["driverUpdates", "Windows driver updates"],
  ["admx", "Administrative templates (ADMX)"],
  ["intents", "Endpoint security (legacy)"],
  ["groups", "Entra groups (referenced)"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Simulated inventory load so the demo shows the real loading screen. */
export async function loadDemoInventory(onProgress: (s: WorkloadStatus[]) => void): Promise<Inventory> {
  const objects = demoObjects().sort((a, b) => a.name.localeCompare(b.name));
  const filters = new Map<string, AssignmentFilter>(
    FILTER_DEFS.map(([name, platform, rule]) => [
      F[name],
      { id: F[name], name, platform, platformLabel: filterPlatformLabel(platform), rule, managementType: "devices" },
    ]),
  );
  const groups = new Map<string, GroupInfo>(GROUP_NAMES.map((n) => [G[n], { id: G[n], name: n }]));
  const orphanedGroupIds = new Set([DELETED_A, DELETED_B]);

  const status: WorkloadStatus[] = LABELS.map(([sid, label]) => ({ id: sid, label, state: "queued", count: 0 }));
  const emit = () => onProgress(status.map((s) => ({ ...s })));
  emit();
  for (const s of status) {
    s.state = "loading";
    emit();
    await sleep(140 + Math.random() * 160);
    if (s.id === "filters") {
      s.state = "done";
      s.count = filters.size;
      s.detail = `${filters.size} filters`;
    } else if (s.id === "groups") {
      s.state = "done";
      s.count = groups.size;
      s.detail = `${groups.size} resolved · ${orphanedGroupIds.size} not found`;
    } else {
      const n = objects.filter((o) => o.workload === s.id).length;
      s.state = "done";
      s.count = n;
      s.detail = `${n} objects`;
    }
    emit();
  }
  return { objects, filters, groups, orphanedGroupIds, status: status.map((s) => ({ ...s })), loadedAt: new Date() };
}

/** Local group search for demo mode (includes a group nothing references). */
export async function searchDemoGroups(term: string): Promise<GroupInfo[]> {
  const all = [...GROUP_NAMES, "SG-HR", "SG-Contractors"].map((n, i) => ({ id: G[n] ?? id(0x180 + i), name: n }));
  const q = term.toLowerCase();
  await sleep(200);
  return all.filter((g) => g.name.toLowerCase().includes(q));
}
