// The menus' size (the user's "the menu stuff could be bigger by default", 2026-10-22): one scale for the main menu and
// its pages (Play, the garage, the account, the training packs, the bots), the settings, the pause menu with its match
// buttons and players, and the popups, from the window: as they were up to 1536 x 864, then growing with the window
// (1.25 at 1920 x 1080, 1.67 at 2560 x 1440), never past either side's share; set as --menu-scale (the stylesheet scales
// each menu's box by it). The HUD, its stage and the end of a match (on the stage, scaled with the window already) keep
// their own.

/** The window size the menus keep their own size at */
const BASE_WIDTH = 1536;
const BASE_HEIGHT = 864;

/** The menus' scale for a `width` x `height` CSS px window */
export function menuScale(width: number, height: number): number {
  return Math.max(1, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT));
}

/** --menu-scale set for the window now, and again whenever it changes size */
export function installMenuScale(root: HTMLElement = document.documentElement): void {
  const apply = (): void => {
    root.style.setProperty("--menu-scale", String(menuScale(window.innerWidth, window.innerHeight)));
  };
  apply();
  window.addEventListener("resize", apply);
}
