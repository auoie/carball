// The browser storage's keys were named "rl-clone.*" until 2026-10-15; shipped files say carball now (the user's
// decision). At start, once, each old key still there moves to its new name, so a player keeps their settings, their
// last playlist and their browser key (and a tab's claim or notice in flight).
// Limits (RV-425): a copy that doesn't fit the store (full) leaves the old key and that load gets the defaults; once
// the new name has a value (any save), the old one is dropped unread. A tab of an older page still open writes the old
// names after the move, and that write is lost. A page from before the move (an image rolled back) reads only the old
// names: it sees the defaults and makes a new browser key, and what it saves is dropped when the newer page returns
// (the new names win).

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The keys that moved: the old name's suffix is the new name's */
const MOVED = ["settings.v1", "playlist", "playerKey", "claim", "menuNotice"] as const;
/** Old keys nothing reads any more, removed: a development build's server address (150e1e6..98b4b57) */
const DROPPED = ["server"] as const;
/** Keys under the new name nothing reads any more, removed with their old names: the development queue's browser key
 *  (its player's account, gone with design 4, RV-1062) */
const RETIRED = ["browserKey"] as const;
const OLD_PREFIX = "rl-clone.";
const NEW_PREFIX = "carball.";

/** Moves each old key's value to its new name (unless the new name has one already) and removes the old key */
export function migrateStorageKeys(store: Store | null): number {
  if (!store) return 0;
  let moved = 0;
  for (const suffix of MOVED) {
    try {
      const old = store.getItem(OLD_PREFIX + suffix);
      if (old === null) continue;
      if (store.getItem(NEW_PREFIX + suffix) === null) store.setItem(NEW_PREFIX + suffix, old);
      store.removeItem(OLD_PREFIX + suffix);
      moved++;
    } catch {
      // (storage blocked or full: the old key stays, the defaults apply)
    }
  }
  const dropped = [...DROPPED.map((s) => OLD_PREFIX + s), ...RETIRED.flatMap((s) => [OLD_PREFIX + s, NEW_PREFIX + s])];
  for (const key of dropped) {
    try {
      // (looked at first: a removal is a write, every load, RV-439)
      if (store.getItem(key) !== null) store.removeItem(key);
    } catch {
      // (storage blocked: it stays)
    }
  }
  return moved;
}

/** Both of the page's stores, if it can reach them */
export function migrateBrowserStorage(): void {
  for (const pick of [() => localStorage, () => sessionStorage]) {
    try {
      migrateStorageKeys(typeof window === "undefined" ? null : pick());
    } catch {
      // (not reachable: nothing to move)
    }
  }
}
