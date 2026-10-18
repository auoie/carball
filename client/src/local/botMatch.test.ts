// Play vs Bots' setup: fitted to the bots there are, the slots' bots on their teams by name and level, kept and handed over
import { describe, expect, it } from "vitest";
import type { BotListing } from "../bots/listing";
import { type BotPick, botMatchSetup, botTeamSizes, fitChoices, readBotMatch, storeBotMatch, storeChoices, storedChoices } from "./botMatch";

const FULL = { id: "full", name: "Full", strength: 1 } as const;
const EZ = { id: "ez", name: "EZ", strength: 0.8 } as const;
const listing = (id: string, name: string, teamSizes: number[], playable = true, levels: BotListing["levels"] = [FULL]): BotListing => ({ id, name, teamSizes, credit: "", licence: "CC BY-NC-SA 4.0", licenceFile: "LICENSE.txt", playable, levels });
const LISTINGS = [listing("nexto", "Nexto", [1, 2, 3], true, [FULL, EZ]), listing("necto", "Necto", [1, 2]), listing("broken", "Broken", [1, 2, 3], false)];
const pick = (bot: string, level = "full"): BotPick => ({ bot, level });

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("Play vs Bots' setup", () => {
  it("offers the team sizes a playable bot plays; none with no playable bot", () => {
    expect(botTeamSizes(LISTINGS)).toEqual([1, 2, 3]);
    expect(botTeamSizes([listing("necto", "Necto", [1, 2])])).toEqual([1, 2]);
    expect(fitChoices(null, [listing("broken", "Broken", [1], false)])).toBeNull();
  });

  it("fits the kept choices: a team size bots play, each slot a bot that plays it (else the first), at a level it offers (else full)", () => {
    expect(fitChoices(null, LISTINGS)).toEqual({ teamSize: 1, teammates: [], opponents: [pick("nexto")] });
    expect(fitChoices({ teamSize: 3, teammates: [pick("necto", "ez"), pick("nexto", "ez")], opponents: [pick("necto"), pick("broken"), pick("nexto", "hard")] }, LISTINGS)).toEqual({
      teamSize: 3,
      teammates: [pick("nexto"), pick("nexto", "ez")],
      opponents: [pick("nexto"), pick("nexto"), pick("nexto")],
    });
    expect(fitChoices({ teamSize: 3, teammates: [], opponents: [] }, [listing("necto", "Necto", [1, 2])])).toEqual({ teamSize: 2, teammates: [pick("necto")], opponents: [pick("necto"), pick("necto")] });
  });

  it("puts the teammates on the player's team and the opponents on the other: named by bot and level (numbered when used twice), at the level's strength", () => {
    const setup = botMatchSetup({ teamSize: 2, teammates: [pick("necto")], opponents: [pick("nexto", "ez"), pick("nexto", "ez")] }, LISTINGS, 1, 42);
    expect(setup).toEqual({
      teamSize: 2,
      seed: 42,
      bots: [
        { team: 1, name: "Necto", brain: "necto" },
        { team: 0, name: "Nexto EZ 1", brain: "nexto", strength: 0.8 },
        { team: 0, name: "Nexto EZ 2", brain: "nexto", strength: 0.8 },
      ],
    });
  });

  it("keeps the choices, and hands the match page a setup it checks (a reload plays it again)", () => {
    const store = memory();
    storeChoices({ teamSize: 2, teammates: [pick("necto")], opponents: [pick("nexto", "ez"), pick("necto")] }, store);
    expect(storedChoices(store)).toEqual({ teamSize: 2, teammates: [pick("necto")], opponents: [pick("nexto", "ez"), pick("necto")] });
    const setup = botMatchSetup({ teamSize: 1, teammates: [], opponents: [pick("nexto", "ez")] }, LISTINGS, 0, 7);
    storeBotMatch(setup, store);
    expect(readBotMatch(store)).toEqual(setup);
    expect(readBotMatch(store)).toEqual(setup);
    store.setItem("carball.botMatch", JSON.stringify({ ...setup, bots: [] }));
    expect(readBotMatch(store)).toBeNull();
    store.setItem("carball.botMatch", JSON.stringify({ ...setup, bots: [{ team: 1, name: "Nexto", brain: "nexto", strength: 3 }] }));
    expect(readBotMatch(store)).toBeNull();
    // (a brain not a bot's id: never fetched by, RV-546)
    for (const brain of ["../index", "nexto/../../x", "https://x", "Nexto", ""]) {
      store.setItem("carball.botMatch", JSON.stringify({ ...setup, bots: [{ team: 1, name: "Nexto", brain }] }));
      expect(readBotMatch(store), brain).toBeNull();
    }
    store.setItem("carball.botMatch", "{");
    expect(readBotMatch(store)).toBeNull();
  });
});
