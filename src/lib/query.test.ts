import { describe, expect, it } from "vitest";
import { demoParentGroups, loadDemoInventory } from "./demo";
import type { Inventory } from "./model";
import { referencesToBuiltIn, referencesToGroup, usageCounts } from "./query";

const byName = (inv: Inventory, name: string) => [...inv.groups.values()].find((g) => g.name === name)!;

describe("referencesToGroup with parent groups", () => {
  it("adds assignments to parent groups at any depth, marked with via, after the direct ones", async () => {
    const inv = await loadDemoInventory(() => {});
    const admins = byName(inv, "SG-IT-ADMINS");
    const parents = await demoParentGroups(admins.id);
    // SG-IT-ADMINS → SG-WIN-VIP → SG-WIN-PROD, and SG-IT-ADMINS → SG-Intune-Licensed
    expect(parents.map((p) => p.name)).toEqual(["SG-Intune-Licensed", "SG-WIN-PROD", "SG-WIN-VIP"]);

    const direct = referencesToGroup(inv, admins.id);
    const all = referencesToGroup(inv, admins.id, parents);
    expect(direct.every((r) => !r.via)).toBe(true);
    expect(all.slice(0, direct.length)).toEqual(direct);
    const inherited = all.slice(direct.length);
    expect(inherited.length).toBeGreaterThan(0);
    for (const r of inherited) expect(parents.map((p) => p.id)).toContain(r.assignment.groupId);
    expect(new Set(inherited.map((r) => r.via!.name))).toContain("SG-WIN-PROD");
  });

  it("is unchanged without parents, and ignores the group itself in the parent list", async () => {
    const inv = await loadDemoInventory(() => {});
    const g = byName(inv, "SG-FINANCE");
    expect(referencesToGroup(inv, g.id, [g])).toEqual(referencesToGroup(inv, g.id));
  });
});

describe("referencesToBuiltIn", () => {
  it("lists every assignment to All Devices / All Users, matching the counts", async () => {
    const inv = await loadDemoInventory(() => {});
    const { builtIn } = usageCounts(inv);
    for (const kind of ["allDevices", "allUsers"] as const) {
      const refs = referencesToBuiltIn(inv, kind);
      expect(refs.every((r) => r.assignment.targetKind === kind)).toBe(true);
      expect(refs.length).toBe(builtIn.get(kind));
    }
    expect(referencesToBuiltIn(inv, "allDevices").map((r) => r.object.name)).toContain("WIN - BitLocker");
  });
});
