/** Normalized, Graph-agnostic model used by every view and the exporter. */

export type PlatformKey =
  | "windows"
  | "macOS"
  | "ios"
  | "androidEnterprise"
  | "androidWorkProfile"
  | "aosp"
  | "androidDeviceAdmin"
  | "linux"
  | "multi"
  | "unknown";

export const PLATFORM_LABEL: Record<PlatformKey, string> = {
  windows: "Windows",
  macOS: "macOS",
  ios: "iOS/iPadOS",
  androidEnterprise: "Android Enterprise",
  androidWorkProfile: "Android Enterprise (work profile)",
  aosp: "Android (AOSP)",
  androidDeviceAdmin: "Android device admin",
  linux: "Linux",
  multi: "Multiple / web",
  unknown: "Unknown",
};

export type WorkloadId =
  | "configurationPolicies"
  | "deviceConfigurations"
  | "compliance"
  | "apps"
  | "platformScripts"
  | "shellScripts"
  | "remediations"
  | "featureUpdates"
  | "qualityUpdates"
  | "driverUpdates"
  | "admx"
  | "intents";

export type TargetKind = "group" | "allUsers" | "allDevices" | "other";

export interface Assignment {
  targetKind: TargetKind;
  /** Entra group object ID when targetKind === "group". */
  groupId?: string;
  intent: "include" | "exclude";
  filterId?: string;
  filterMode?: "include" | "exclude";
  /** Apps only: required / available / uninstall / availableWithoutEnrollment. */
  appIntent?: string;
  /** Raw @odata.type of the target, for "other" targets. */
  rawType?: string;
}

export interface IntuneObject {
  /** Unique across workloads. */
  key: string;
  id: string;
  name: string;
  workload: WorkloadId;
  typeLabel: string;
  platform: PlatformKey;
  /** Will the v1.0 Editor be able to change this object's assignments? */
  writable: boolean;
  assignments: Assignment[];
}

export interface AssignmentFilter {
  id: string;
  name: string;
  platform: string;
  platformLabel: string;
  rule: string;
  managementType: string;
}

export interface GroupInfo {
  id: string;
  name: string;
}

/** "skipped" = not loaded in this mode (e.g. apps/scripts in Editor mode — no consent for them). */
export type LoadState = "queued" | "loading" | "done" | "error" | "skipped";

export interface WorkloadStatus {
  id: WorkloadId | "filters" | "groups";
  label: string;
  state: LoadState;
  count: number;
  detail?: string;
  error?: string;
}

export interface Inventory {
  objects: IntuneObject[];
  filters: Map<string, AssignmentFilter>;
  groups: Map<string, GroupInfo>;
  /** Group IDs referenced by assignments that no longer exist in Entra. */
  orphanedGroupIds: Set<string>;
  status: WorkloadStatus[];
  loadedAt: Date;
}
