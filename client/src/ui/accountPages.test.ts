// The account page's refusals in our words (src/ui/accountPages.ts): name moderation's, an admin's lock with its time
// left
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAME_RULES, accountErrorText, lockLeftText, nameProblem } from "./accountPages";

describe("the account page's refusals", () => {
  it("a name the filter refuses; a rename locked, for how long when the API says", () => {
    expect(accountErrorText("name-not-allowed")).toBe("That name isn't allowed.");
    expect(accountErrorText("rename-locked", 3 * 86_400)).toBe("Your name can't be changed for 3 days.");
    expect(accountErrorText("rename-locked")).toBe("Your name can't be changed for now.");
  });

  it("a lock's time left: days from two days, hours from two hours, else minutes, each rounded up", () => {
    expect([30 * 86_400, 2 * 86_400, 2 * 86_400 - 1, 2 * 3_600, 7_199, 61, 1, 0].map(lockLeftText)).toEqual([
      "30 days",
      "2 days",
      "48 hours",
      "2 hours",
      "120 minutes",
      "2 minutes",
      "1 minute",
      "1 minute",
    ]);
  });
});

describe("a name before it's sent (the API's rules)", () => {
  it("4 to 25 letters, digits and underscores; the surrounding spaces off; another character said first", () => {
    for (const ok of ["Zigg", "a".repeat(25), "Ziggy_Stardust", "xX_Sn1per_Xx", " Padded_Name "]) expect(nameProblem(ok), ok).toBeNull();
    expect(nameProblem("")).toBe("name-empty");
    expect(nameProblem("   ")).toBe("name-empty");
    expect(nameProblem("Zig")).toBe("name-too-short");
    expect(nameProblem("a".repeat(26))).toBe("name-too-long");
    for (const bad of ["Ziggy Stardust", "Ziggy-Stardust", "Zoë_Name", "Иван_Name", "a b", "Zig.gy"]) expect(nameProblem(bad), bad).toBe("name-invalid");
    expect([NAME_RULES.min, NAME_RULES.max]).toEqual([4, 25]);
  });

  it("each refusal in its words", () => {
    expect(accountErrorText("name-too-short")).toBe("That name is too short: 4 characters at least.");
    expect(accountErrorText("name-too-long")).toBe("That name is too long: 25 characters at most.");
    expect(accountErrorText("name-invalid")).toBe("Use only letters, numbers and underscores.");
    expect(accountErrorText("name-empty")).toBe("Enter a name.");
  });
});

/** The cases the API judges alike (api/internal/names/testdata/cases.json: its suite's too, RV-1178) */
const SHARED = JSON.parse(readFileSync(new URL("../../../api/internal/names/testdata/cases.json", import.meta.url), "utf8")) as {
  cases: { in: string; want: "ok" | "too-short" | "too-long" | "invalid" }[];
};

describe("a name as the API judges it (the shared cases)", () => {
  it("its surrounding ASCII whitespace off and nothing else, then the alphabet, then the length", () => {
    expect(SHARED.cases.length).toBeGreaterThan(10);
    for (const c of SHARED.cases) expect(nameProblem(c.in), JSON.stringify(c.in)).toBe(c.want === "ok" ? null : `name-${c.want}`);
  });
});
