// Play vs Bots' page (the main menu's bots page: notes in ui/mainMenu.ts), its body drawn here in a chunk of its own, loaded
// with the bot packages' listing (not in the page's main bundle): the team sizes some bot plays, each slot's choice of the
// bots that play the size (and of its bot's levels, where it offers more than full), the credits of the bots chosen; the
// choices kept (local/botMatch.ts).
import { BOTS_BASE, type BotListing } from "../bots/listing";
import { PLAYLISTS } from "../game/matchmaking";
import { type BotChoices, type BotPick, type TeamSize, botTeamSizes, fitChoices, storeChoices, storedChoices } from "../local/botMatch";
import { BOT_MATCH_TEXT } from "../local/botText";

/** The page's body as drawn: whether there's a bot to play, and its choices now */
export interface BotsPage {
  readonly playable: boolean;
  choices(): BotChoices | null;
}

/** The page's body drawn into `body` for these bot packages (its choices fitted to them), drawn anew at each change */
/** A credit's link, opened in a new tab */
function creditLink(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "main-menu-bot-link";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}

export function botsPage(body: HTMLElement, listings: readonly BotListing[]): BotsPage {
  let state = fitChoices(storedChoices(), listings);
  const draw = (): void => {
    const choices = state;
    body.replaceChildren();
    if (!choices) return;
    const choose = (next: BotChoices): void => {
      state = fitChoices(next, listings);
      if (state) storeChoices(state);
      draw();
    };
    const radios = <T>(className: string, items: readonly { value: T; label: string; checked: boolean }[], pick: (value: T) => void): HTMLDivElement => {
      const group = document.createElement("div");
      group.className = `main-menu-choices ${className}`;
      group.setAttribute("role", "radiogroup");
      group.dataset["padChoose"] = "";
      for (const item of items) {
        const b = document.createElement("button");
        b.className = "main-menu-button";
        b.textContent = item.label;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(item.checked));
        b.addEventListener("click", () => {
          pick(item.value);
        });
        group.append(b);
      }
      return group;
    };
    const sizes = botTeamSizes(listings).map((n) => ({
      value: n,
      label: PLAYLISTS.find((p) => p.teamSize === n)?.name ?? `${String(n)}v${String(n)}`,
      checked: n === choices.teamSize,
    }));
    body.append(
      radios<TeamSize>("main-menu-bot-sizes", sizes, (teamSize) => {
        choose({ ...choices, teamSize });
      }),
    );
    const bots = listings.filter((l) => l.playable && l.teamSizes.includes(choices.teamSize));
    const slots = (label: string, side: "teammates" | "opponents"): void => {
      if (choices[side].length === 0) return;
      const title = document.createElement("div");
      title.className = "main-menu-bot-side";
      title.textContent = label;
      body.append(title);
      choices[side].forEach((picked, i) => {
        const pick = (next: BotPick): void => {
          choose({ ...choices, [side]: choices[side].map((old, j) => (j === i ? next : old)) });
        };
        const items = bots.map((b) => ({ value: b.id, label: b.name, checked: b.id === picked.bot }));
        body.append(
          radios("main-menu-bot-slot", items, (bot) => {
            pick({ bot });
          }),
        );
      });
    };
    slots(BOT_MATCH_TEXT.teammates, "teammates");
    slots(BOT_MATCH_TEXT.opponents, "opponents");
    // (each bot chosen credited: its package's credit line, which names its licence (the packages' terms), else its name and
    // licence; its web addresses links, and a link to the licence's text beside its policy: RV-544)
    const credits = document.createElement("div");
    credits.className = "main-menu-bot-credits";
    const chosen = [...new Set([...choices.teammates, ...choices.opponents].map((p) => p.bot))];
    for (const l of chosen.map((id) => listings.find((b) => b.id === id)).filter((b): b is BotListing => b !== undefined)) {
      const line = document.createElement("div");
      for (const part of (l.credit === "" ? `${l.name} · ${l.licence}` : l.credit).split(/(https:\/\/[^\s,]+)/)) {
        if (part.startsWith("https://")) line.append(creditLink(part, part));
        else if (part !== "") line.append(part);
      }
      line.append(" ", creditLink(BOT_MATCH_TEXT.licenceText, `${BOTS_BASE}${l.id}/${l.licenceFile}`));
      credits.append(line);
    }
    body.append(credits);
  };
  draw();
  return { playable: state !== null, choices: () => state };
}
