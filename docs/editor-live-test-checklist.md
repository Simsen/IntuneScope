# Editor — live-tenant test checklist

Things the unit tests can't prove, because they depend on how Microsoft Graph and Intune actually behave.
Run in a **test tenant** (or with test policies only). For every Editor run, keep the downloaded backup and execution report.

Record for each case: date, result (Pass / Fail / Graph rejected), and the report's `preWrite` / `written` / `readBack` if anything looks off.

## Setup

- [ ] Two test Entra groups: `IS-TEST-A`, `IS-TEST-B`
- [ ] One assignment filter per platform you test (Windows 10 and later, macOS, iOS/iPadOS, Android Enterprise)
- [ ] Graph Explorer (or PowerShell `Invoke-MgGraphRequest`) signed in to the same tenant, beta endpoint
- [ ] IntuneScope Editor build that includes the assignment-fields fix (`@intunescope.assignment`)

## 1. Assignment-level `intent` on Device configuration

Before this fix the Editor sent only `{ target }`; it now also sends assignment fields such as `intent`.

- [ ] **What Graph returns.** `GET /beta/deviceManagement/deviceConfigurations/{id}/assignments` on a few profile types. Note whether `intent` is present and its value.
- [ ] **`intent: "apply"` is accepted on write.** Editor → Add `IS-TEST-A` to a Device configuration profile. Expect *Succeeded*. If Graph returns 400, the fix must stop sending `intent` (change `NOT_WRITTEN` in `src/lib/editor.ts`).
- [ ] **A `remove` intent survives.** If a profile with `intent: "remove"` can be created (Graph Explorer `POST …/assign` with `"intent": "remove"`), run Editor → Add `IS-TEST-B` and check that the existing assignment still reads back with `intent: "remove"`.
- [ ] **New assignments verify cleanly.** After any Add, the result is *Succeeded*, not *Verification failed* (a new assignment has no intent; Graph should default it to `apply`, which the signature treats as equal).
- [ ] **Backup restore.** Take a backup's `restore` body for a profile with intent present and POST it with Graph Explorer. The assignments should come back exactly as before.
- [ ] Same Add on a **Settings Catalog** and a **Compliance** policy. Check that their `/assign` body contains no new fields (compare `written` in the report).

## 2. Targets the Editor doesn't build itself (pass-through)

Unknown target types are kept and posted back as read. This was only checked in unit tests.

- [ ] **Configuration Manager collection target** (tenant attach). Take an Endpoint Security policy assigned to a collection, run Editor → Change filter or Add on it, and expect either *Succeeded* with the collection kept, or a clear Graph error. Note which.
- [ ] **Decide whether ConfigMgr policies should be writable at all.** Endpoint Security policies whose `technologies` include `configManager` are assigned to collections, not Entra groups, and `isWritableTemplateFamily` currently marks them writable. If adding an Entra group to one is meaningless or rejected, make them read-only in `src/lib/inventory.ts`.
- [ ] **Collection swap is detected.** Preview an edit on that policy, change its collection in the portal before applying, and expect *Changed since preview*.
- [ ] Any other target `@odata.type` seen in the tenant (check the Explorer's "Other target" rows): Editor run, then the result and read-back.

## 3. Extra properties on read-back

The verify step compares group / All users / All devices targets on type, groupId and filter only. Other target types are compared on all properties.

- [ ] Run one Add, one Replace, one Remove and one Change filter on a Settings Catalog, Device configuration and Compliance policy each. All should be *Succeeded*. Any *Verification failed* with an identical-looking `written` vs `readBack` means Graph added a property; note which.

## 4. Filters per Device configuration profile type

Graph does not validate whether a profile type supports filters. A filter on an unsupported type is silently accepted and never applies.

Compare against Microsoft's "Supported workloads when creating filters" list (learn.microsoft.com → Intune → Filters → supported workloads).

For each profile type in the tenant, Editor → Change filter (set a filter), then open the profile in the Intune portal:

| Profile type (`@odata.type`) | Filter shown in portal? | Supported per docs? | Action |
|---|---|---|---|
| windows10CustomConfiguration | | | |
| windows10GeneralConfiguration | | | |
| windows10EndpointProtectionConfiguration | | | |
| windowsUpdateForBusinessConfiguration (update ring) | | | |
| windowsDomainJoinConfiguration | | | |
| editionUpgradeConfiguration | | | |
| windowsKioskConfiguration | | | |
| windowsWifiConfiguration | | | |
| macOSCustomConfiguration | | | |
| iosGeneralDeviceConfiguration | | | |
| iosUpdateConfiguration | | | |
| androidDeviceOwnerGeneralDeviceConfiguration | | | |
| androidWorkProfileGeneralDeviceConfiguration | | | |

- [ ] Every "No" becomes a block in the Editor, so filter operations are refused for that type and only target operations are allowed.
- [ ] Also check **All users / All devices** support for the same types (e.g. domain join is device-only).

## 5. Filter platforms

- [ ] **Multi-platform Settings Catalog policy:** confirm that no filter is offered (expected today), and decide whether that's right.
- [ ] **Linux Settings Catalog policy:** confirm that no filter is offered. Intune has no Linux filter platform today.
- [ ] **Windows 8.1 compliance policy (if any exist):** only Windows 10 and later filters are offered. Decide whether to allow `windows81AndLater` or make these read-only.
- [ ] **Android work profile (`androidForWork…` / `androidWorkProfile…` device configuration):** a filter is offered and shows correctly in the portal.
