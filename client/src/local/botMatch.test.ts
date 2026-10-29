// Play vs Bots' setup: fitted to the bots there are, the slots' bots on their teams by name, kept and handed over
import { describe, expect, it } from "vitest";
import type { BotListing } from "../bots/listing";
import {
  type BotPick,
  botMatchSetup,
  botTeamSizes,
  fitChoices,
  playerNameOnceKnown,
  readBotMatch,
  storeBotMatch,
  storeChoices,
  storedChoices,
} from "./botMatch";

// (made-up packages: the menu's logic for any number of them)
const listing = (id: string, name: string, teamSizes: number[], playable = true): BotListing => ({
  id,
  name,
  teamSizes,
  credit: "",
  licence: "MIT",
  licenceFile: "LICENSE.txt",
  playable,
});
const LISTINGS = [listing("wisp", "Wisp", [1, 2, 3]), listing("ember", "Ember", [1, 2]), listing("broken", "Broken", [1, 2, 3], false)];
const pick = (bot: string): BotPick => ({ bot });

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("Play vs Bots' setup", () => {
  it("offers the team sizes a playable bot plays; none with no playable bot", () => {
    expect(botTeamSizes(LISTINGS)).toEqual([1, 2, 3]);
    expect(botTeamSizes([listing("ember", "Ember", [1, 2])])).toEqual([1, 2]);
    expect(fitChoices(null, [listing("broken", "Broken", [1], false)])).toBeNull();
  });

  it("fits the kept choices: a team size bots play, each slot a bot that plays it (else the first)", () => {
    expect(fitChoices(null, LISTINGS)).toEqual({ teamSize: 1, teammates: [], opponents: [pick("wisp")] });
    expect(fitChoices({ teamSize: 3, teammates: [pick("ember"), pick("wisp")], opponents: [pick("ember"), pick("broken"), pick("gone")] }, LISTINGS)).toEqual({
      teamSize: 3,
      teammates: [pick("wisp"), pick("wisp")],
      opponents: [pick("wisp"), pick("wisp"), pick("wisp")],
    });
    expect(fitChoices({ teamSize: 3, teammates: [], opponents: [] }, [listing("ember", "Ember", [1, 2])])).toEqual({
      teamSize: 2,
      teammates: [pick("ember")],
      opponents: [pick("ember"), pick("ember")],
    });
  });

  it("puts the teammates on the player's team and the opponents on the other: named by bot (numbered when used twice)", () => {
    const setup = botMatchSetup({ teamSize: 2, teammates: [pick("ember")], opponents: [pick("wisp"), pick("wisp")] }, LISTINGS, 1, 42);
    expect(setup).toEqual({
      teamSize: 2,
      seed: 42,
      bots: [
        { team: 1, name: "Ember", brain: "ember" },
        { team: 0, name: "Wisp 1", brain: "wisp" },
        { team: 0, name: "Wisp 2", brain: "wisp" },
      ],
      playerName: "Player",
    });
  });

  it("names the player once the account is read: a Start before it keeps the signed-in name, else Player (RV-1191)", async () => {
    let account: { name: string } | null = null;
    let read = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      read = resolve;
    });
    const named = playerNameOnceKnown(ready, () => account);
    // (the account arrives after the click)
    account = { name: "Signed_In" };
    read();
    expect(await named).toBe("Signed_In");
    expect(await playerNameOnceKnown(Promise.resolve(), () => null)).toBe("Player");
    // (an account read that failed: Player, never stuck)
    expect(await playerNameOnceKnown(Promise.reject(new Error("down")), () => null)).toBe("Player");
  });

  it("keeps the choices, and hands the match page a setup it checks (a reload plays it again)", () => {
    const store = memory();
    storeChoices({ teamSize: 2, teammates: [pick("ember")], opponents: [pick("wisp"), pick("ember")] }, store);
    expect(storedChoices(store)).toEqual({ teamSize: 2, teammates: [pick("ember")], opponents: [pick("wisp"), pick("ember")] });
    const setup = botMatchSetup({ teamSize: 1, teammates: [], opponents: [pick("wisp")] }, LISTINGS, 0, 7, "Signed_In");
    storeBotMatch(setup, store);
    expect(readBotMatch(store)).toEqual(setup);
    expect(readBotMatch(store)).toEqual(setup);
    // (the player's name: the account's as stored; a setup from before it, or one not a short string: "Player", RV-1186)
    expect(readBotMatch(store)?.playerName).toBe("Signed_In");
    for (const playerName of [undefined, 7, "", "x".repeat(33)]) {
      store.setItem("carball.botMatch", JSON.stringify({ ...setup, playerName }));
      expect(readBotMatch(store)?.playerName).toBe("Player");
    }
    store.setItem("carball.botMatch", JSON.stringify({ ...setup, bots: [] }));
    expect(readBotMatch(store)).toBeNull();
    // (a slot's fields beyond its team, name and brain left behind)
    store.setItem("carball.botMatch", JSON.stringify({ ...setup, bots: [{ team: 1, name: "Wisp", brain: "wisp", strength: 0.8 }] }));
    expect(readBotMatch(store)?.bots).toEqual([{ team: 1, name: "Wisp", brain: "wisp" }]);
    // (a brain not a bot's id: never fetched by, RV-546)
    for (const brain of ["../index", "wisp/../../x", "https://x", "Wisp", ""]) {
      store.setItem("carball.botMatch", JSON.stringify({ ...setup, bots: [{ team: 1, name: "Wisp", brain }] }));
      expect(readBotMatch(store), brain).toBeNull();
    }
    store.setItem("carball.botMatch", "{");
    expect(readBotMatch(store)).toBeNull();
  });
});
