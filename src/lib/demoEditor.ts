/** Demo mode Editor: same engine, in-memory "tenant" built from the sample inventory. Nothing leaves the browser. */
import { buildTarget, type RawAssignment, type RawTarget } from "./editor";
import type { EditorIO } from "./editorRun";
import type { IntuneObject } from "./model";
import { normalizeAssignment } from "./normalize";

const toRaw = (o: IntuneObject): RawTarget[] =>
  o.assignments.map((a) =>
    buildTarget(
      a.targetKind === "allUsers" ? { kind: "allUsers" } : a.targetKind === "allDevices" ? { kind: "allDevices" } : { kind: "group", groupId: a.groupId ?? "" },
      a.intent,
      a.filterId && a.filterMode ? { id: a.filterId, mode: a.filterMode } : null,
    ),
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wrap = (ts: RawTarget[]): RawAssignment[] => ts.map((target, i) => ({ id: `demo-${i}`, source: "direct", target }));

export function demoIO(): EditorIO {
  return {
    async readMany(objects, onProgress) {
      await sleep(300);
      onProgress?.(objects.length);
      return objects.map((o) => wrap(toRaw(o)));
    },
    async read(o) {
      await sleep(120);
      return wrap(toRaw(o));
    },
    async write(o, targets) {
      await sleep(250);
      // Mutate the sample inventory so Explorer shows the result after the run.
      o.assignments = targets.map((target) => normalizeAssignment({ target: target as never }));
    },
  };
}
