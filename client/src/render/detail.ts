// World Detail's gates (notes/post-processing.md §13, QG-14/15: UE3's DetailMode): a piece marked with the lowest system
// detail it's drawn at (Medium: World Detail High Quality and Quality; High: High Quality only), shown or hidden as the
// setting changes. Unmarked pieces are always drawn
import type { Object3D } from "three";
import type { WorldDetail } from "../settings/video";

/** A piece's DetailMode: DM_Medium (gone at Performance), DM_High (gone at Quality and Performance) */
export type DetailMode = "medium" | "high";

const SYSTEM: Readonly<Record<WorldDetail, number>> = { highQuality: 2, quality: 1, performance: 0 };
const PIECE: Readonly<Record<DetailMode, number>> = { medium: 1, high: 2 };

/** Marks `piece` drawn only at `mode` or above; returns it */
export function detailMode<T extends Object3D>(piece: T, mode: DetailMode): T {
  (piece.userData as { detailMode?: DetailMode }).detailMode = mode;
  return piece;
}

/** Each marked piece under `root` shown or hidden for `level`; the count shown and hidden */
export function applyWorldDetail(root: Object3D, level: WorldDetail): { readonly shown: number; readonly hidden: number } {
  let [shown, hidden] = [0, 0];
  root.traverse((o) => {
    const mode = (o.userData as { detailMode?: DetailMode }).detailMode;
    if (!mode) return;
    o.visible = PIECE[mode] <= SYSTEM[level];
    if (o.visible) shown++;
    else hidden++;
  });
  return { shown, hidden };
}
