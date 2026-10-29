// Shared training packs (the accounts service's: notes/custom-training.md §9): a share code as typed made the API's
// shape; a shared pack as the menu lists it (its url "shared:CODE": read through the API when played, its download
// counted there) and as played or saved (its file checked as any pack is, its creator the uploader's display name)
import type { SharedPack } from "../account/api";
import { newPackId } from "./myPacks";
import { type TrainingPack, parsePack } from "./pack";
import type { PackListing } from "./packs";

/** A shared pack's listing url: SHARED and its code */
export const SHARED = "shared:";

/** A share code as the API takes it (XXXX-XXXX-XXXX-XXXX, upper case) from one typed, as the game reads it
 *  (notes/custom-training.md §9, PACKS1): everything but letters and digits dropped, 16 left, in fours, upper case
 *  (any letters: one the service never made just isn't found); null: not 16 */
export function shareCode(typed: string): string | null {
  const code = typed.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  if (code.length !== 16) return null;
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`;
}

/** A shared pack's listing in the menu (its type and difficulty as the page knows them) */
export function sharedListing(p: SharedPack): PackListing {
  const type = p.type === "goalie" || p.type === "aerial" ? p.type : "striker";
  const difficulty = p.difficulty === "medium" || p.difficulty === "hard" ? p.difficulty : "easy";
  return { id: `shared-${p.code.toLowerCase()}`, name: p.name, type, difficulty, shots: p.shots, creator: p.creator, url: `${SHARED}${p.code}` };
}

/** A shared pack's file as played: checked as any pack (else what's wrong), its creator the uploader's display name */
export function sharedPackOf(file: unknown, creator: string): TrainingPack | string {
  const pack = parsePack(file);
  return typeof pack === "string" ? pack : { ...pack, creator };
}

/** How many ids a saved copy draws before giving up (each taken: a broken random source, never chance) */
const ID_DRAWS = 8;

/** A shared pack saved among the player's own: a copy, an id of its own, none of `taken` (editable; its creator kept;
 *  a pack stored with a taken id would replace that one, RV-1202); null: no free id in ID_DRAWS draws (RV-1204) */
export function savedCopy(pack: TrainingPack, taken: ReadonlySet<string>, random: () => number = Math.random): TrainingPack | null {
  for (let i = 0; i < ID_DRAWS; i++) {
    const id = newPackId(random);
    if (!taken.has(id)) return { ...pack, id };
  }
  return null;
}
