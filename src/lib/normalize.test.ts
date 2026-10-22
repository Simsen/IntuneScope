import { describe, expect, it } from "vitest";
import { colName, toCsv, toXlsx } from "./export";
import type { Inventory } from "./model";
import {
  appTypeLabel,
  normalizeAssignment,
  platformFromODataType,
  platformFromSettingsCatalog,
  settingsCatalogTypeLabel,
} from "./normalize";
import { exportRows, targetName } from "./query";

describe("normalizeAssignment", () => {
  it("parses an included group with include filter", () => {
    const a = normalizeAssignment({
      target: {
        "@odata.type": "#microsoft.graph.groupAssignmentTarget",
        groupId: "g1",
        deviceAndAppManagementAssignmentFilterId: "f1",
        deviceAndAppManagementAssignmentFilterType: "include",
      },
    });
    expect(a).toMatchObject({ targetKind: "group", groupId: "g1", intent: "include", filterId: "f1", filterMode: "include" });
  });
  it("parses exclusion groups", () => {
    const a = normalizeAssignment({ target: { "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget", groupId: "g2" } });
    expect(a).toMatchObject({ targetKind: "group", groupId: "g2", intent: "exclude" });
    expect(a.filterId).toBeUndefined();
  });
  it("ignores 'none' and zero-GUID filters", () => {
    const a = normalizeAssignment({
      target: {
        "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget",
        deviceAndAppManagementAssignmentFilterId: "00000000-0000-0000-0000-000000000000",
        deviceAndAppManagementAssignmentFilterType: "none",
      },
    });
    expect(a).toMatchObject({ targetKind: "allDevices" });
    expect(a.filterId).toBeUndefined();
  });
  it("keeps app intent", () => {
    const a = normalizeAssignment({ intent: "required", target: { "@odata.type": "#microsoft.graph.allLicensedUsersAssignmentTarget" } });
    expect(a).toMatchObject({ targetKind: "allUsers", appIntent: "required" });
  });
});

describe("platform mapping", () => {
  it.each([
    ["#microsoft.graph.windows10GeneralConfiguration", "windows"],
    ["#microsoft.graph.windowsUpdateForBusinessConfiguration", "windows"],
    ["#microsoft.graph.win32LobApp", "windows"],
    ["#microsoft.graph.macOSCompliancePolicy", "macOS"],
    ["#microsoft.graph.iosGeneralDeviceConfiguration", "ios"],
    ["#microsoft.graph.androidWorkProfileCompliancePolicy", "androidWorkProfile"],
    ["#microsoft.graph.androidDeviceOwnerGeneralDeviceConfiguration", "androidEnterprise"],
    ["#microsoft.graph.aospDeviceOwnerCompliancePolicy", "aosp"],
    ["#microsoft.graph.androidGeneralDeviceConfiguration", "androidDeviceAdmin"],
    ["#microsoft.graph.something", "unknown"],
  ])("%s → %s", (t, p) => expect(platformFromODataType(t)).toBe(p));

  it("maps settings catalog platforms", () => {
    expect(platformFromSettingsCatalog("windows10")).toBe("windows");
    expect(platformFromSettingsCatalog("macOS")).toBe("macOS");
    expect(platformFromSettingsCatalog("windows10,macOS")).toBe("multi");
  });
});

describe("labels", () => {
  it("labels templates", () => {
    expect(settingsCatalogTypeLabel("none")).toBe("Settings catalog");
    expect(settingsCatalogTypeLabel("endpointSecurityAntivirus")).toBe("Endpoint security · Antivirus");
    expect(settingsCatalogTypeLabel("endpointSecurityAttackSurfaceReduction")).toBe("Endpoint security · Attack Surface Reduction");
    expect(appTypeLabel("#microsoft.graph.win32LobApp")).toBe("App · Win32");
  });
});

describe("export", () => {
  const inv = {
    objects: [],
    filters: new Map([["f1", { id: "f1", name: "WIN-Corp", platform: "windows10AndLater", platformLabel: "Windows", rule: "", managementType: "devices" }]]),
    groups: new Map([["g1", { id: "g1", name: "SG-PILOT" }]]),
    orphanedGroupIds: new Set(["g9"]),
    status: [],
    loadedAt: new Date(),
  } as unknown as Inventory;

  it("names targets, including deleted groups", () => {
    expect(targetName({ targetKind: "group", groupId: "g1", intent: "include" }, inv)).toBe("SG-PILOT");
    expect(targetName({ targetKind: "group", groupId: "g9aaaaaaaa", intent: "include" }, inv)).toBe("g9aaaaaaaa");
    expect(targetName({ targetKind: "group", groupId: "g9", intent: "include" }, inv)).toMatch(/^Deleted group/);
  });

  it("writes one row per assignment and one for unassigned", () => {
    const rows = exportRows(
      [
        {
          key: "a",
          id: "p1",
          name: "Pol",
          workload: "compliance",
          typeLabel: "Compliance",
          platform: "windows",
          writable: true,
          assignments: [
            { targetKind: "group", groupId: "g1", intent: "include", filterId: "f1", filterMode: "include" },
            { targetKind: "allUsers", intent: "include" },
          ],
        },
        { key: "b", id: "p2", name: "Empty", workload: "compliance", typeLabel: "Compliance", platform: "windows", writable: true, assignments: [] },
      ],
      inv,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].slice(4, 10)).toEqual(["SG-PILOT", "Group", "Include", "", "WIN-Corp", "Include"]);
    expect(rows[2][4]).toBe("(unassigned)");
  });

  it("escapes CSV and adds BOM", () => {
    const csv = toCsv(["a", "b"], [['x,"y"', "æøå"]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"x,""y"""');
  });

  it("builds column names and a zip", () => {
    expect([colName(0), colName(25), colName(26), colName(27)]).toEqual(["A", "Z", "AA", "AB"]);
    const z = toXlsx([{ name: "S", header: ["h"], rows: [["v & <x>"]] }]);
    expect(z[0]).toBe(0x50); // "PK"
    expect(z[1]).toBe(0x4b);
  });
});
