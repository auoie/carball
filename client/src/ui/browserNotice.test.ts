import { describe, expect, it } from "vitest";
import { BROWSER_NOTICE_TEXT as T, browserLimits, browserNoticeDismissed, browserRecommendation, dismissBrowserNotice } from "./browserNotice";

const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("a browser's limits for binds (RV-1104)", () => {
  it("only the confirmed ones: Firefox's thumb buttons by name, no keyboard lock by feature (RV-1114)", () => {
    expect(browserLimits({ keyboardLock: false, userAgent: FIREFOX })).toEqual([T.thumbs, T.shortcuts]);
    expect(browserLimits({ keyboardLock: true, userAgent: CHROME }), "a Chromium browser: none").toEqual([]);
    expect(browserLimits({ keyboardLock: false, userAgent: SAFARI }), "no lock, not Firefox").toEqual([T.shortcuts]);
  });

  it("recommends a Chromium browser, but on an iPhone or iPad (every browser Safari's engine there)", () => {
    expect(browserRecommendation(FIREFOX)).toBe(T.recommend);
    expect(
      browserRecommendation(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(T.ios);
  });

  it("the main menu's notice dismissed for good where storage works, shown again where it fails", () => {
    const map = new Map<string, string>();
    const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(browserNoticeDismissed(store)).toBe(false);
    dismissBrowserNotice(store);
    expect(browserNoticeDismissed(store)).toBe(true);
    const broken = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    expect(() => {
      dismissBrowserNotice(broken);
    }).not.toThrow();
    expect(browserNoticeDismissed(broken)).toBe(false);
  });
});
