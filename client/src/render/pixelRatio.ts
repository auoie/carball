// The screen's device pixel ratio as it changes: the window moved to a screen of another density, the browser's zoom
// changed. Neither need change the canvas's CSS size (no ResizeObserver call), so the ratio is watched by its own media
// query, made again at each change for the new ratio. Read once at the load, a page moved from a 2x screen to a 1x one
// went on drawing four times the screen's pixels (and its frame-rate guard could step the quality down for it); the
// other way, a quarter of them until a reload (the 2026-11-11 audit's REN-04).

/** What of `window` the watch uses */
export interface RatioWindow {
  readonly devicePixelRatio: number;
  matchMedia(query: string): Pick<MediaQueryList, "addEventListener" | "removeEventListener">;
}

/** Calls `changed` whenever the device pixel ratio changes; returns the watch's end */
export function watchPixelRatio(changed: () => void, view: RatioWindow = window): () => void {
  let stop = (): void => undefined;
  const watch = (): void => {
    const query = view.matchMedia(`(resolution: ${String(view.devicePixelRatio)}dppx)`);
    const moved = (): void => {
      stop();
      watch();
      changed();
    };
    query.addEventListener("change", moved);
    stop = (): void => {
      query.removeEventListener("change", moved);
    };
  };
  watch();
  return () => {
    stop();
  };
}
