// A browser that can't take every bind (RV-1091, RV-1104; the user's request): its confirmed limits said (RV-1114: no
// claim unconfirmed), with Chrome or another Chromium browser (Edge, Brave) recommended, but on an iPhone or iPad, where
// every browser is Safari's engine. Once on the main menu, its dismissal kept in this
// browser (storage failing: shown again next time), and always on the Controls screen. Found by feature where a page can
// (no Keyboard Lock: a Ctrl or Alt bind's browser shortcuts), by name where it can't (Firefox's thumb buttons and pads)
import { keyboardLockAvailable } from "./displayMode";

const DISMISSED_KEY = "carball.browserNotice";

export const BROWSER_NOTICE_TEXT = {
  title: "Some binds can't work in this browser",
  thumbs: "Mouse 4 and Mouse 5 can't be bound: Firefox doesn't pass them to web pages (Mozilla bug 1933746).",
  shortcuts: "A Ctrl, Alt or Cmd bind can set off the browser's own shortcuts (Ctrl+W or Cmd+W closes the tab): this browser has no keyboard lock.",
  recommend: "For every bind, play in Chrome or another Chromium browser (Edge, Brave).",
  ios: "On an iPhone or iPad every browser shares these limits.",
  dismiss: "Got it",
} as const;

/** This browser's limits for binds, each a line: none in a Chromium browser */
export function browserLimits(env: { readonly keyboardLock: boolean; readonly userAgent: string }): string[] {
  const T = BROWSER_NOTICE_TEXT;
  const firefox = /\bFirefox\//.test(env.userAgent);
  return [...(firefox ? [T.thumbs] : []), ...(env.keyboardLock ? [] : [T.shortcuts])];
}

/** What the notice recommends: a Chromium browser, but where there's none (an iPhone's, an iPad's: an iPad's Safari says
 *  it's a Mac's, told apart by its touch screen, RV-1121) */
export function browserRecommendation(userAgent: string, touchPoints = 0): string {
  const ios = /\b(iPhone|iPad|iPod)\b/.test(userAgent) || (/\bMacintosh\b/.test(userAgent) && touchPoints > 1);
  return ios ? BROWSER_NOTICE_TEXT.ios : BROWSER_NOTICE_TEXT.recommend;
}

/** This page's browser's limits */
export function currentBrowserLimits(): string[] {
  return browserLimits({ keyboardLock: keyboardLockAvailable(), userAgent: navigator.userAgent });
}

function local(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Whether the main menu's notice was dismissed in this browser */
export function browserNoticeDismissed(storage = local()): boolean {
  try {
    return storage?.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissBrowserNotice(storage = local()): void {
  try {
    storage?.setItem(DISMISSED_KEY, "1");
  } catch {
    // (not kept: shown again next time)
  }
}

/** The notice: its title, the limits, the recommendation; with `dismiss`, a button that takes it away (the main menu's) */
export function browserNotice(lines: readonly string[], dismiss?: () => void): HTMLElement {
  const T = BROWSER_NOTICE_TEXT;
  const root = document.createElement("div");
  root.className = dismiss ? "browser-notice" : "browser-notice inline";
  const title = document.createElement("strong");
  title.textContent = T.title;
  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  const recommend = document.createElement("p");
  recommend.textContent = browserRecommendation(navigator.userAgent, navigator.maxTouchPoints);
  root.append(title, list, recommend);
  if (dismiss) {
    const button = document.createElement("button");
    button.textContent = T.dismiss;
    button.addEventListener("click", () => {
      root.remove();
      dismiss();
    });
    root.append(button);
  }
  return root;
}
