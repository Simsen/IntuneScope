import { createContext, useContext } from "react";
import type { IntuneObject } from "../lib/model";

/** Where a bulk edit was started from — pre-selects a sensible operation. */
export type BulkHint = { groupId?: string; filterId?: string };

export interface EditorCtx {
  /** Signed in with the Editor (read/write) registration. */
  editor: boolean;
  /** Editor registration is configured for this deployment (offer the switch). */
  canEditor: boolean;
  onSwitchToEditor: () => void;
  startBulkEdit: (objects: IntuneObject[], hint?: BulkHint) => void;
}

export const EditorContext = createContext<EditorCtx>({
  editor: false,
  canEditor: false,
  onSwitchToEditor: () => {},
  startBulkEdit: () => {},
});

export const useEditor = () => useContext(EditorContext);
