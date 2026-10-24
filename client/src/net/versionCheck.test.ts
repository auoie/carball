import { describe, expect, it } from "vitest";
import { sentence } from "../ui/modal";
import { MATCHMAKER_TEXT } from "./matchmaker";
import { VersionCheck, reloadText } from "./versionCheck";

/** A check whose page is `apart` (or not) from its deployment, what it shows recorded */
function made(apart: boolean): { check: VersionCheck; shown: string[] } {
  const shown: string[] = [];
  const check = new VersionCheck({
    apart: () => Promise.resolve(apart),
    reload: () => shown.push("reload"),
    notice: (text) => shown.push(text),
  });
  return { check, shown };
}

/** The promises the checks set off, settled */
const settled = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe("the page's version against its servers' (RV-1030, RV-1078)", () => {
  it("a ping refused on version marks its region and asks for the reload, once, of a page apart (V10)", async () => {
    const { check, shown } = made(true);
    check.answered("eu", "outdated");
    await settled();
    expect([...check.outdated]).toEqual(["eu"]);
    expect(shown).toEqual(["reload"]);
    check.answered("us", "outdated");
    await settled();
    expect(shown, "once").toEqual(["reload"]);
    // (a pong clears its mark; no answer leaves it)
    check.answered("eu", { ms: 30, server: "eu.example:4433" });
    check.answered("us", null);
    expect([...check.outdated]).toEqual(["us"]);
  });

  it("never asks the deployment's own page to reload (its server the one not updated yet)", async () => {
    const { check, shown } = made(false);
    check.answered("eu", "outdated");
    await settled();
    expect([...check.outdated]).toEqual(["eu"]);
    expect(shown).toEqual([]);
  });

  it("a search of refused regions alone says the reload's words when the page is apart, else whose servers are updated (V11, V14)", async () => {
    const apart = made(true);
    expect(await apart.check.refusal(false)).toBe(reloadText());
    expect(await apart.check.refusal(true)).toBe(reloadText());
    expect(apart.shown, "the reload's modal once").toEqual(["reload"]);
    const own = made(false);
    expect(await own.check.refusal(false)).toBe(MATCHMAKER_TEXT.behind);
    // (nothing ticked: not the ticked regions' words, RV-1068)
    expect(await own.check.refusal(true)).toBe(MATCHMAKER_TEXT.updating);
    expect(own.shown).toEqual([]);
  });

  it("a claim refused on version: the reload when the page is apart, else that match's server being updated (V13, RV-1069)", async () => {
    const apart = made(true);
    await apart.check.claimRefused();
    expect(apart.shown).toEqual(["reload"]);
    const own = made(false);
    await own.check.claimRefused();
    expect(own.shown).toEqual([MATCHMAKER_TEXT.matchUpdating]);
  });

  it("says a reason as a modal's sentence", () => {
    expect(sentence("the servers are being updated")).toBe("The servers are being updated.");
  });
});
