// What a phone's or a browser's platform can't do (src/ui/platformNotices.ts; notes/mobile.md): the Apple devices and
// their versions from made-up user agents, bots' and online play's limits
import { describe, expect, it } from "vitest";
import { PLATFORM_TEXT, appleTouch, appleVersion, botsBlocked, onlineBlocked } from "./platformNotices";

const IPHONE_17_4 = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
// (iOS 26's own: its "OS" kept at 18_6, the version in Safari's Version/: RV-1230)
const IPHONE_26_4 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

describe("Apple's touch devices", () => {
  it("an iPhone, and an iPad saying it's a Mac (told by its touch screen); a Mac or an Android phone not", () => {
    expect(appleTouch(IPHONE_17_4)).toBe(true);
    expect(appleTouch(IPAD_AS_MAC, 5)).toBe(true);
    expect(appleTouch(IPAD_AS_MAC, 0)).toBe(false);
    expect(appleTouch(ANDROID, 5)).toBe(false);
  });

  it("their version: an iPhone's OS, an iPad-as-Mac's Safari version; none on another", () => {
    expect(appleVersion(IPHONE_17_4)).toEqual([17, 4]);
    expect(appleVersion(IPAD_AS_MAC)).toEqual([17, 2]);
    expect(appleVersion(IPHONE_26_4)).toEqual([26, 4]);
    expect(appleVersion("Mozilla/5.0 (X11; Linux x86_64)")).toBeNull();
  });
});

describe("what can't run here", () => {
  it("bots: an iPhone or iPad before 17.5, else no WebAssembly SIMD", () => {
    expect(botsBlocked({ userAgent: IPHONE_17_4, touchPoints: 5, simd: true })).toBe(PLATFORM_TEXT.botsApple);
    expect(botsBlocked({ userAgent: IPAD_AS_MAC, touchPoints: 5, simd: true })).toBe(PLATFORM_TEXT.botsApple);
    expect(botsBlocked({ userAgent: IPHONE_26_4, touchPoints: 5, simd: true })).toBeNull();
    expect(botsBlocked({ userAgent: ANDROID, touchPoints: 5, simd: false })).toBe(PLATFORM_TEXT.botsSimd);
    expect(botsBlocked({ userAgent: ANDROID, touchPoints: 5, simd: true })).toBeNull();
  });

  it("online play: without WebTransport, in an Apple device's own words there", () => {
    expect(onlineBlocked({ userAgent: IPHONE_17_4, touchPoints: 5, webTransport: false })).toBe(PLATFORM_TEXT.onlineApple);
    expect(onlineBlocked({ userAgent: ANDROID, touchPoints: 5, webTransport: false })).toBe(PLATFORM_TEXT.online);
    expect(onlineBlocked({ userAgent: IPHONE_26_4, touchPoints: 5, webTransport: true })).toBeNull();
  });
});
