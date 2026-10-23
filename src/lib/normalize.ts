import type { Assignment, PlatformKey } from "./model";

/** Pure mapping helpers: Graph shapes → normalized model. Unit-tested. */

const strip = (t: string | undefined) => (t ?? "").replace(/^#?microsoft\.graph\./, "");

/** "windowsUpdateForBusinessConfiguration" → "Windows Update For Business Configuration" */
export function humanize(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Platform from an @odata.type (device configurations, compliance, apps). */
export function platformFromODataType(odataType: string | undefined): PlatformKey {
  const t = strip(odataType);
  if (!t) return "unknown";
  if (/^(windows|win32|winGet|win10|officeSuite|microsoftStoreForBusiness|sharedPC|editionUpgrade)/i.test(t)) return "windows";
  if (/^macOS/i.test(t)) return "macOS";
  if (/^(ios|managedIOS)/i.test(t)) return "ios";
  if (/^androidWorkProfile/i.test(t)) return "androidWorkProfile";
  if (/^(androidDeviceOwner|androidForWork|androidManagedStore)/i.test(t)) return "androidEnterprise";
  if (/^aosp/i.test(t)) return "aosp";
  if (/^managedAndroid/i.test(t)) return "androidEnterprise";
  if (/^android/i.test(t)) return "androidDeviceAdmin";
  if (/^webApp$/i.test(t)) return "multi";
  return "unknown";
}

/** Platform from configurationPolicies.platforms (flags enum, comma separated). */
export function platformFromSettingsCatalog(platforms: string | undefined): PlatformKey {
  const parts = (platforms ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) return "multi";
  switch (parts[0]) {
    case "windows10":
    case "windows10X":
      return "windows";
    case "macOS":
      return "macOS";
    case "iOS":
      return "ios";
    case "androidEnterprise":
      return "androidEnterprise";
    case "aosp":
      return "aosp";
    case "android":
      return "androidDeviceAdmin";
    case "linux":
      return "linux";
    default:
      return "unknown";
  }
}

/** Assignment filter platform enum → readable label. */
export function filterPlatformLabel(p: string): string {
  const map: Record<string, string> = {
    windows10AndLater: "Windows 10 and later",
    windows81AndLater: "Windows 8.1 and later",
    macOS: "macOS",
    iOS: "iOS/iPadOS",
    androidForWork: "Android Enterprise",
    androidWorkProfile: "Android Enterprise (work profile)",
    androidAOSP: "Android (AOSP)",
    android: "Android device admin",
    androidMobileApplicationManagement: "Android (app protection)",
    iOSMobileApplicationManagement: "iOS/iPadOS (app protection)",
    windowsMobileApplicationManagement: "Windows (app protection)",
  };
  return map[p] ?? humanize(p);
}

/** Settings Catalog families the Editor may write in v1: plain Settings Catalog and modern Endpoint Security. */
export function isWritableTemplateFamily(templateFamily: string | undefined): boolean {
  const f = templateFamily ?? "none";
  return f === "none" || f.startsWith("endpointSecurity");
}

/** Type label for a Settings Catalog / modern Endpoint Security policy. */
export function settingsCatalogTypeLabel(templateFamily: string | undefined): string {
  const f = templateFamily ?? "none";
  if (f === "none") return "Settings catalog";
  if (f.startsWith("endpointSecurity")) return `Endpoint security · ${humanize(f.replace("endpointSecurity", ""))}`;
  if (f === "baseline") return "Security baseline";
  if (f === "enrollmentConfiguration") return "Enrollment configuration";
  return humanize(f);
}

const DEVICE_CONFIG_LABELS: Record<string, string> = {
  windowsUpdateForBusinessConfiguration: "Update ring",
  windows10CustomConfiguration: "Custom (OMA-URI)",
  windows10GeneralConfiguration: "Device restrictions",
  windows10EndpointProtectionConfiguration: "Endpoint protection",
  windowsWifiConfiguration: "Wi-Fi",
  windowsKioskConfiguration: "Kiosk",
  windowsHealthMonitoringConfiguration: "Health monitoring",
  windowsIdentityProtectionConfiguration: "Identity protection",
  windowsDomainJoinConfiguration: "Domain join",
  windowsDeliveryOptimizationConfiguration: "Delivery optimization",
  sharedPCConfiguration: "Shared multi-user device",
  editionUpgradeConfiguration: "Edition upgrade",
  macOSCustomConfiguration: "Custom (profile)",
  macOSGeneralDeviceConfiguration: "Device restrictions",
  macOSEndpointProtectionConfiguration: "Endpoint protection",
  macOSExtensionsConfiguration: "Extensions",
  iosCustomConfiguration: "Custom (profile)",
  iosGeneralDeviceConfiguration: "Device restrictions",
  iosDeviceFeaturesConfiguration: "Device features",
};

export function deviceConfigTypeLabel(odataType: string | undefined): string {
  const t = strip(odataType);
  return `Device configuration · ${DEVICE_CONFIG_LABELS[t] ?? (humanize(t.replace(/Configuration$/, "")) || "Other")}`;
}

const APP_LABELS: Record<string, string> = {
  win32LobApp: "Win32",
  win32CatalogApp: "Win32 (Enterprise App Catalog)",
  winGetApp: "Microsoft Store",
  windowsMobileMSI: "MSI line-of-business",
  windowsUniversalAppX: "MSIX/AppX",
  officeSuiteApp: "Microsoft 365 Apps",
  windowsMicrosoftEdgeApp: "Microsoft Edge",
  windowsWebApp: "Web link",
  webApp: "Web link",
  macOSDmgApp: "DMG",
  macOSPkgApp: "PKG",
  macOSLobApp: "Line-of-business",
  macOSMicrosoftEdgeApp: "Microsoft Edge",
  macOSOfficeSuiteApp: "Microsoft 365 Apps",
  macOsVppApp: "VPP",
  iosVppApp: "VPP",
  iosStoreApp: "App Store",
  iosLobApp: "Line-of-business",
  androidManagedStoreApp: "Managed Google Play",
  androidManagedStoreWebApp: "Managed Google Play web link",
  androidStoreApp: "Google Play",
  androidLobApp: "Line-of-business",
};

export function appTypeLabel(odataType: string | undefined): string {
  const t = strip(odataType);
  return `App · ${APP_LABELS[t] ?? humanize(t.replace(/App$/, ""))}`;
}

interface RawTarget {
  "@odata.type"?: string;
  groupId?: string;
  deviceAndAppManagementAssignmentFilterId?: string | null;
  deviceAndAppManagementAssignmentFilterType?: string | null;
}

interface RawAssignment {
  target?: RawTarget;
  intent?: string;
}

const ZERO_GUID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/;

/** Graph assignment (any workload) → normalized Assignment. */
export function normalizeAssignment(raw: RawAssignment): Assignment {
  const t = raw.target ?? {};
  const type = strip(t["@odata.type"]);
  const a: Assignment = { targetKind: "other", intent: "include", rawType: type };
  switch (type) {
    case "groupAssignmentTarget":
      a.targetKind = "group";
      a.groupId = t.groupId;
      break;
    case "exclusionGroupAssignmentTarget":
      a.targetKind = "group";
      a.groupId = t.groupId;
      a.intent = "exclude";
      break;
    case "allLicensedUsersAssignmentTarget":
      a.targetKind = "allUsers";
      break;
    case "allDevicesAssignmentTarget":
      a.targetKind = "allDevices";
      break;
  }
  const fid = t.deviceAndAppManagementAssignmentFilterId;
  const ftype = t.deviceAndAppManagementAssignmentFilterType;
  if (fid && !ZERO_GUID.test(fid) && (ftype === "include" || ftype === "exclude")) {
    a.filterId = fid;
    a.filterMode = ftype;
  }
  // Apps carry required/available/uninstall; policy assignments carry a generic "apply"/"remove" that is noise in the UI.
  if (raw.intent && raw.intent !== "apply" && raw.intent !== "remove") a.appIntent = raw.intent;
  return a;
}
