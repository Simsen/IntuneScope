/**
 * Resume state for the optional "Include parent groups" consent. Asking for GroupMember.Read.All
 * leaves the page, so Group lookup remembers the group it was showing and reopens it afterwards.
 */
const KEY = "intunescope-nested";
const ERR = "intunescope-nested-error";

export function nestedResume(): { groupId: string } | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v ? (JSON.parse(v) as { groupId: string }) : null;
  } catch {
    return null;
  }
}

export function clearNestedResume() {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(ERR);
  } catch {
    /* ignore */
  }
}

export function setNestedConsentError(message: string) {
  try {
    sessionStorage.setItem(ERR, message);
  } catch {
    /* ignore */
  }
}

export function nestedConsentError(): string | null {
  try {
    return sessionStorage.getItem(ERR);
  } catch {
    return null;
  }
}
