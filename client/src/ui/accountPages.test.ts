// The account page's refusals in our words (src/ui/accountPages.ts): name moderation's, an admin's lock with its time
// left
import { describe, expect, it } from "vitest";
import { accountErrorText, lockLeftText } from "./accountPages";

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
