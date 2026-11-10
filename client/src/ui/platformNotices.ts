// What a phone's or a browser's platform can't do, said on the menus (notes/mobile.md): online play needs WebTransport
// (an iPhone's from iOS 26.4); Play vs Bots its runtime (onnxruntime-web: WebAssembly SIMD, and on an iPhone or iPad
// iOS 17.5 or later, JavaScriptCore failing it before); and on an iPhone, full screen only as a home-screen app (Add to
// Home Screen), which also keeps the site's storage past Safari's 7-day purge.

export const PLATFORM_TEXT = {
  online: "Online play needs WebTransport, which this browser doesn't have.",
  onlineApple: "Online play needs iOS 26.4 or later on an iPhone or iPad.",
  botsSimd: "Play vs Bots needs WebAssembly SIMD, which this browser doesn't have.",
  botsApple: "Play vs Bots needs iOS 17.5 or later on an iPhone or iPad.",
  homeTitle: "Play full screen",
  homeBody: "Tap Share, then Add to Home Screen, and open Carball from there: Safari can't hide its bars otherwise.",
  homeStorage:
    "The home-screen app also keeps your settings and training packs (Safari clears a site's storage after 7 days without a visit). You sign in again there.",
  dismiss: "Got it",
} as const;

/** An iPhone, iPod or iPad (an iPad's Safari says it's a Mac's, told apart by its touch screen, RV-1121) */
export function appleTouch(userAgent: string, touchPoints = 0): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && touchPoints > 1);
}

/** An Apple touch device's system version from its user agent ("OS 17_4" on an iPhone's, Safari's "Version/17.4" on an
 *  iPad's that says it's a Mac's), else null */
export function appleVersion(userAgent: string): readonly [number, number] | null {
  // (Safari's Version/ first: iOS 26's "OS" stays 18_6, RV-1230)
  const m = /\bVersion\/(\d+)\.(\d+)/.exec(userAgent) ?? /\bOS (\d+)_(\d+)/.exec(userAgent);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

const below = (v: readonly [number, number] | null, major: number, minor: number): boolean => v !== null && (v[0] < major || (v[0] === major && v[1] < minor));

/** Why Play vs Bots can't run here, else null: no WebAssembly SIMD, or an iPhone's or iPad's system before 17.5 */
export function botsBlocked(env: { readonly userAgent: string; readonly touchPoints: number; readonly simd: boolean }): string | null {
  if (appleTouch(env.userAgent, env.touchPoints) && below(appleVersion(env.userAgent), 17, 5)) return PLATFORM_TEXT.botsApple;
  return env.simd ? null : PLATFORM_TEXT.botsSimd;
}

/** Why online play can't happen here, else null: no WebTransport (an Apple touch device's own words) */
export function onlineBlocked(env: { readonly userAgent: string; readonly touchPoints: number; readonly webTransport: boolean }): string | null {
  if (env.webTransport) return null;
  return appleTouch(env.userAgent, env.touchPoints) ? PLATFORM_TEXT.onlineApple : PLATFORM_TEXT.online;
}

/** Whether WebAssembly SIMD compiles here (a module of one v128 constant: wasm-feature-detect's test) */
export function wasmSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

/** This page's: why bots can't run, why online play can't */
export function pageBotsBlocked(): string | null {
  return botsBlocked({ userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints, simd: wasmSimd() });
}

export function pageOnlineBlocked(): string | null {
  return onlineBlocked({ userAgent: navigator.userAgent, touchPoints: navigator.maxTouchPoints, webTransport: typeof WebTransport === "function" });
}

/** Running as a home-screen app (iOS's `navigator.standalone`, or the manifest's display) */
export function homeScreenApp(): boolean {
  const standalone = (navigator as { readonly standalone?: boolean }).standalone === true;
  return standalone || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches);
}

const HINT_KEY = "carball.homeScreenHint";

function local(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether the Add to Home Screen hint is due: an iPhone's Safari page (an iPad's only without element full screen, which
 *  its Safari has from 16.4: RV-1226), not the home-screen app, not dismissed */
export function homeScreenHintDue(storage = local()): boolean {
  const iPhone = /\b(iPhone|iPod)\b/.test(navigator.userAgent);
  const fullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
  if (!appleTouch(navigator.userAgent, navigator.maxTouchPoints) || (!iPhone && fullscreen) || homeScreenApp()) return false;
  try {
    return storage?.getItem(HINT_KEY) !== "1";
  } catch {
    return true;
  }
}

/** The hint, in the browser notice's look (browserNotice.ts): dismissed, kept so (storage failing: shown next time) */
export function homeScreenHint(storage = local()): HTMLElement {
  const T = PLATFORM_TEXT;
  const root = document.createElement("div");
  root.className = "browser-notice";
  const title = document.createElement("strong");
  title.textContent = T.homeTitle;
  const body = document.createElement("p");
  body.textContent = T.homeBody;
  const keep = document.createElement("p");
  keep.textContent = T.homeStorage;
  const button = document.createElement("button");
  button.textContent = T.dismiss;
  button.addEventListener("click", () => {
    root.remove();
    try {
      storage?.setItem(HINT_KEY, "1");
    } catch {
      // (not kept: shown again next time)
    }
  });
  root.append(title, body, keep, button);
  return root;
}
