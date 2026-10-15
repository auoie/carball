// The browser storage's keys were named "rl-clone.*" until 2026-10-15; shipped files say carball now (the user's
// decision). At start, once, each old key still there moves to its new name, so a player keeps their settings, their
// last playlist and their browser key (and a tab's claim or notice in flight).

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The keys that moved: the old name's suffix is the new name's */
const MOVED = ["settings.v1", "playlist", "browserKey", "playerKey", "claim", "menuNotice"] as const;
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
