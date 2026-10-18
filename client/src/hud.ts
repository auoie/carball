// On-screen overlay: the game's HUD on its virtual stage (notes/hud-menus.md HUD-1..12: the scoreboard, the boost
// meter, the centre messages, the replay's banner, the ball-cam indicator), and ours: the flip indicator, speed, camera
// mode, help.
import type { SpawnSide } from "./engine/world";
import type { FlipResetIndicator, InterfaceSettings, MatchNotifications } from "./settings/settings";
import { fitStage } from "./ui/stage";
import type { Dodge } from "./game/flipTracker";
import { type VoteHud, voteFlashes } from "./game/forfeitVote";
import { respawnShown } from "./game/matchSequence";
import type { MatchState } from "./net/protocol";
import { ACTIONS, type Bindings, inputName } from "./input/bindings";
import { type KeyGlyph, clearPrompt, glyphElement, renderPrompt } from "./ui/keyGlyph";
import { FlipLamp } from "./ui/flipLamp";
import { FuelGaugeArt } from "./ui/fuelGauge";
import { SCOREBUG_REST, SCORE_INTRO_END, ScorebugArt, scoreIntroPose } from "./ui/scorebug";
import { setNumberText } from "./ui/numberCells";

/** The local car demolished, in play: the game's respawn view (HUD-20, RH1: ChooseRespawnView): its two bars shrinking
 *  toward the hourglass over the pick's 2.5 s in 1 % steps, the side picked and its spot (the steer input picks:
 *  inner first), each side's key */
export interface RespawnHud {
  /** What's left of the pick, 0..100 in 1 % steps (the game's replicated integer) */
  readonly pct: number;
  readonly side: SpawnSide | null;
  /** The inner spot of that side (else the outer) */
  readonly inner: boolean;
  /** The keys that pick each side (the active device's steer bindings) */
  readonly keys: { readonly left: KeyGlyph | null; readonly right: KeyGlyph | null };
}

/** The game's prompts (upper-cased by the HUD) and the bars' turn to orange at 60 % (RH1) */
export const RESPAWN_TEXT = { left: "Respawn Left", right: "Respawn Right" } as const;
export const RESPAWN_LATE_PCT = 60;

/** RLConst DEMO_PRESPAWN_STATE_LENGTH: the spot locks this long before the respawn; the pick takes the rest. */
const PRESPAWN_SECONDS = 0.5;
const PICK_SECONDS = 2.5;

/** The respawn view from a demolished car's state (null when it isn't, or once its spot is locked: cleared at the
 *  prespawn, RH1) */
export function respawnHud(
  car: { readonly demoed: boolean; readonly demoRespawnTimer: number; readonly spawnSelection: { readonly side: SpawnSide | null; readonly index: number } },
  keys: RespawnHud["keys"] = { left: null, right: null },
): RespawnHud | null {
  if (!car.demoed || car.demoRespawnTimer <= PRESPAWN_SECONDS) return null;
  const pct = Math.min(100, Math.max(0, Math.floor(((car.demoRespawnTimer - PRESPAWN_SECONDS) / PICK_SECONDS) * 100)));
  return { pct, side: car.spawnSelection.side, inner: car.spawnSelection.index === 0, keys };
}

/** The respawn view a game shows: its car's (respawnHud) where the match's phase lets it show (respawnShown: free play,
 *  no match, always) */
export function respawnView(
  car: Parameters<typeof respawnHud>[0] | null | undefined,
  match: Pick<MatchState, "phase"> | null | undefined,
  keys: RespawnHud["keys"],
): RespawnHud | null {
  return car && respawnShown(match) ? respawnHud(car, keys) : null;
}

/** Whether the bars are orange (RH1: from 60 % down, at it too) */
export function respawnLate(pct: number): boolean {
  return pct <= RESPAWN_LATE_PCT;
}

/** The meter's "low" cue: its shown number at 15 or under */
export function boostLow(shown: number): boolean {
  return shown <= 15;
}

/** The boost meter's number (GFxHUD_TA.GetBoostAmountForUI): floor(pct · 100), at least 1 while any is left
 *  (notes/visual-timing.md VT-21) */
export function boostShown(boost: number): number {
  return boost <= 0 ? 0 : Math.min(100, Math.max(1, Math.floor(boost)));
}

/** Flip Reset Indicator's parts (MENU-9): its look (our flip ring and the reset's toast) and its sound */
export function flipVisual(mode: FlipResetIndicator): boolean {
  return mode === "visual" || mode === "on";
}

export function flipAudio(mode: FlipResetIndicator): boolean {
  return mode === "audio" || mode === "on";
}

/** A centre message's level (EHUDMessageLevel, HT-7): 0 All (pause messages), 1 GameUpdates (Overtime!, the clock's
 *  minute, 30 s and last ten), 2 Essential (the kickoff's countdown and GO!, the goal). Shown when the Match
 *  Notifications setting's threshold is at or under it (All 0, Time Updates Only 1, Kickoffs Only 2) */
export type MessageLevel = 0 | 1 | 2;
export const ESSENTIAL: MessageLevel = 2;
export const GAME_UPDATE: MessageLevel = 1;
const THRESHOLD: Readonly<Record<MatchNotifications, MessageLevel>> = { all: 0, gameUpdates: 1, kickoff: 2 };

export function messageShown(level: MessageLevel, setting: MatchNotifications): boolean {
  return THRESHOLD[setting] <= level;
}

/** A centre message lives this long after the last one, then fades in 0.3 s (GameMessageView) */
const MESSAGE_SECONDS = 4;
const MESSAGE_FADE = 0.3;

/** The goal replay's banner (HUD-11) */
export interface ReplayHud {
  /** "Press {key} to Skip" until the player skips (the ReadyUp binding's glyph: HT-3; null: none) */
  readonly prompt: KeyGlyph | null;
  /** Who isn't ready yet (null: nothing shown) */
  readonly waiting: string | null;
  /** The goal: its scorer and assister, the clock at the goal and the ball's speed (null: not known) */
  readonly goal: ReplayGoal | null;
}

/** The replay's goal speed (HT-6: the ball's speed rounded to uu/s, then round(x 0.036) KPH, or round(x 0.0223694)
 *  MPH, by Metric; KPH / MPH verbatim) */
export function replaySpeed(speed: number, metric: boolean): { readonly value: number; readonly unit: string } {
  const uu = Math.round(speed);
  // (in the movie's own order of operations: UnitUtils.convert, v x from / to)
  return metric ? { value: Math.round((uu * 3600 * 0.01) / 1000), unit: "KPH" } : { value: Math.round((uu * 36) / 1609.344), unit: "MPH" };
}

/** The replay's goal time (HT-6: the round's age at the goal, from its kickoff countdown's start; whole seconds, M:SS) */
export function replayTime(seconds: number): string {
  const t = Math.round(seconds);
  const sign = t < 0 ? "-" : "";
  const a = Math.abs(t);
  return `${sign}${String(Math.floor(a / 60))}:${String(a % 60).padStart(2, "0")}`;
}

export interface ReplayGoal {
  /** null: no scorer to show (an own goal: HT-6) */
  readonly scorer: { readonly name: string; readonly team: number } | null;
  readonly assister: { readonly name: string; readonly team: number } | null;
  readonly time: string | null;
  readonly speed: { readonly value: number; readonly unit: string } | null;
}

/** The replay banner's icons (ours: the game's Icon_ScoreAssist / Time / Speed show there, no text labels) */
const ICONS = {
  assist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15l6-6 4 4 6-6v4h2V3h-8v2h4l-4 4-4-4-8 8z"/></svg>',
  time: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 5h-2v6l5 3 1-1.7-4-2.3z"/></svg>',
  speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a10 10 0 00-10 10h3a7 7 0 0114 0h3A10 10 0 0012 4zm4.2 4.4L11 13.6a2 2 0 102.8 2.8l5.2-5.2z"/></svg>',
} as const;

export interface HudState {
  readonly boost: number;
  readonly speed: number; // uu/s
  readonly supersonic: boolean;
  readonly score: readonly [number, number];
  /** The match clock (null: no match, as in freeplay) */
  readonly clock: string | null;
  readonly ballCam: boolean;
  /** A message that stays until it's gone (a disconnection); null: the queued ones (`say`) */
  readonly message: string | null;
  /** The goal replay's banner (null or absent: not in a replay) */
  readonly replay?: ReplayHud | null;
  /** "OVERTIME" in the clock's slot (overtime's kickoff, until its clock runs: HUD-3) */
  readonly overtimeLabel?: boolean;
  /** The local player's team (theirs on the left: HUD-2); absent: blue */
  readonly localTeam?: number;
  /** The camera is the local car's (its own or ball cam; not a replay, a podium or the joining view: HUD-16) */
  readonly carView?: boolean;
  /** A menu is over the HUD */
  readonly menuOpen?: boolean;
  /** The ball cam's toggle key, when it toggles (null: held, or nothing to say) */
  readonly ballCamKey?: KeyGlyph | null;
  readonly fps: number;
  readonly net: string | null; // online: ping and buffer
  /** Whether the car can dodge (null: the indicator is turned off) */
  readonly flip: Dodge | null;
  /** A flip reset happened since the last update */
  readonly flipReset: boolean;
  /** The local car is demolished (null: it isn't) */
  readonly respawn: RespawnHud | null;
  /** The team's forfeit vote while it runs (null or absent: none; the widget fades out) */
  readonly vote?: VoteHud | null;
  /** The match's HUD parts shown (online, by phase: MIO-5/17; absent: both, as freeplay) */
  readonly parts?: { readonly scoreboard: boolean; readonly boost: boolean; readonly ballCamIndicator?: boolean };
}

function element<T extends HTMLElement>(root: ParentNode, selector: string, type: new () => T): T {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`HUD element ${selector} missing`);
  return el;
}

/** The status line's speed and fps readouts: at most this often (s) */
const READOUT_EVERY = 0.1;

export class Hud {
  readonly #root: HTMLElement;
  readonly #stage: HTMLElement;
  readonly #stageFit = { key: "" };
  readonly #boostValue: HTMLElement;
  readonly #boostArt: FuelGaugeArt;
  readonly #speed: HTMLElement;
  readonly #blue: HTMLElement;
  readonly #scoreBox: HTMLElement;
  readonly #boostBox: HTMLElement;
  readonly #clock: HTMLElement;
  readonly #orange: HTMLElement;
  readonly #camera: HTMLElement;
  readonly #message: HTMLElement;
  readonly #clockOvertime: HTMLElement;
  readonly #scoreTilt: HTMLElement;
  readonly #scoreArt: ScorebugArt;
  readonly #replay: HTMLElement;
  readonly #replayInfo: HTMLElement;
  readonly #replayPrompt: HTMLElement;
  readonly #replayWaiting: HTMLElement;
  readonly #ballCam: HTMLElement;
  readonly #ballCamToggle: HTMLElement;
  readonly #fps: HTMLElement;
  readonly #net: HTMLElement;
  /** The status line's texts as last written, and when its readouts last were */
  readonly #written = new Map<HTMLElement, string>();
  #readoutAt = -Infinity;
  readonly #help: HTMLElement;
  readonly #flip: HTMLElement;
  readonly #flipLamp: FlipLamp;
  readonly #flipDetail: HTMLElement;
  readonly #respawn: HTMLElement;
  readonly #respawnLeft: HTMLElement;
  readonly #respawnRight: HTMLElement;
  /** Each side's prompt as drawn (its key), redrawn only when that changes */
  readonly #respawnDrawn = { left: "", right: "" };
  readonly #vote: HTMLElement;
  readonly #voteTally: HTMLElement;
  readonly #voteTime: HTMLElement;
  readonly #voteFill: HTMLElement;
  readonly #voteHint: HTMLElement;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#stage = element(root, "#hud-stage", HTMLElement);
    this.#boostValue = element(root, "#boost-value", HTMLElement);
    this.#boostArt = new FuelGaugeArt(element(root, "#boost", HTMLElement));
    this.#speed = element(root, "#speed", HTMLElement);
    this.#blue = element(root, "#score-blue", HTMLElement);
    this.#scoreBox = element(root, "#score", HTMLElement);
    this.#boostBox = element(root, "#boost", HTMLElement);
    this.#orange = element(root, "#score-orange", HTMLElement);
    this.#clock = element(root, "#clock", HTMLElement);
    this.#camera = element(root, "#camera-mode", HTMLElement);
    this.#message = element(root, "#message", HTMLElement);
    this.#clockOvertime = element(root, "#clock-overtime", HTMLElement);
    this.#scoreTilt = element(root, "#score-tilt", HTMLElement);
    this.#scoreArt = new ScorebugArt(this.#scoreTilt, { digits: [this.#blue, this.#orange], clock: [this.#clock, this.#clockOvertime] });
    this.#replay = element(root, "#replay-banner", HTMLElement);
    this.#replayInfo = element(root, "#replay-info", HTMLElement);
    this.#replayPrompt = element(root, "#replay-prompt", HTMLElement);
    this.#replayWaiting = element(root, "#replay-waiting", HTMLElement);
    this.#ballCam = element(root, "#ballcam", HTMLElement);
    this.#ballCamToggle = element(root, "#ballcam-toggle", HTMLElement);
    this.#fps = element(root, "#fps", HTMLElement);
    this.#net = element(root, "#net", HTMLElement);
    this.#help = element(root, "#help", HTMLElement);
    this.#flip = element(root, "#flip", HTMLElement);
    this.#flipDetail = element(root, "#flip-detail", HTMLElement);
    this.#flipLamp = new FlipLamp(this.#flip);
    this.#respawn = element(root, "#respawn", HTMLElement);
    this.#respawnLeft = element(root, "#respawn-left", HTMLElement);
    this.#respawnRight = element(root, "#respawn-right", HTMLElement);
    this.#vote = element(root, "#vote", HTMLElement);
    this.#voteTally = element(root, "#vote-tally", HTMLElement);
    this.#voteTime = element(root, "#vote-time", HTMLElement);
    this.#voteFill = element(root, "#vote-fill", HTMLElement);
    this.#voteHint = element(root, "#vote-hint", HTMLElement);
  }

  /** Shows or hides the controls list, filled from the current bindings. */
  toggleHelp(bindings: Bindings): void {
    this.#help.hidden = !this.#help.hidden;
    if (this.#help.hidden) return;
    const rows = ACTIONS.map((a) => {
      const b = bindings[a.id];
      const row = document.createElement("tr");
      for (const text of [a.label, inputName(b.keyboard), inputName(b.gamepad)]) {
        const td = document.createElement("td");
        td.textContent = text;
        row.append(td);
      }
      return row;
    });
    const head = document.createElement("tr");
    for (const text of ["", "Keyboard & mouse", "Gamepad"]) {
      const th = document.createElement("th");
      th.textContent = text;
      head.append(th);
    }
    const table = document.createElement("table");
    table.append(head, ...rows);
    const title = document.createElement("h2");
    title.textContent = "Controls (Esc: change them)";
    this.#help.replaceChildren(title, table);
  }

  #ui: InterfaceSettings | null = null;

  /** The Interface settings the HUD follows */
  configure(ui: InterfaceSettings): void {
    this.#ui = ui;
  }

  /** A centre message (HUD-8/9/10: the countdown, a goal, the clock's warnings): it pops in, replacing the last, and
   *  fades 4 s after; one under the Match Notifications setting's level isn't shown; "" clears it at once */
  say(text: string, level: MessageLevel = ESSENTIAL): void {
    if (text === "") {
      this.#said = null;
      return;
    }
    if (this.#ui && !messageShown(level, this.#ui.matchNotifications)) return;
    this.#said = { text, at: performance.now() / 1000 };
    this.#popMessage = true;
  }

  #said: { readonly text: string; readonly at: number } | null = null;
  #popMessage = false;
  #messageText = "";

  /** `el`'s text, written only if it changed */
  #text(el: HTMLElement, text: string): void {
    if (this.#written.get(el) === text) return;
    this.#written.set(el, text);
    el.textContent = text;
  }

  update(s: HudState): void {
    const now = performance.now() / 1000;
    const stage = fitStage(this.#stage, this.#stageFit);
    this.#root.classList.toggle("hud-hidden", this.#ui?.hideHud ?? false);
    const carView = s.carView ?? true;
    const menuOpen = s.menuOpen ?? false;
    const team = s.localTeam === 1 ? 1 : 0;
    this.#updateScoreboard(s, team);
    this.#updateBoost(s.boost, team, (s.parts?.boost ?? true) && carView && !menuOpen, now);
    this.#updateMessage(s.message, now, stage.width);
    this.#updateReplay(s.replay ?? null);
    const ballCam = (this.#ui?.ballCamIndicator ?? true) && s.ballCam && carView && !menuOpen && (s.parts?.ballCamIndicator ?? true);
    this.#ballCam.classList.toggle("shown", ballCam);
    const key = s.ballCamKey ?? null;
    if (key === null) clearPrompt(this.#ballCamToggle);
    else renderPrompt(this.#ballCamToggle, key, "Toggle"); // (HT-3: the pad's and the mouse's buttons as icons)
    // (the status line: each text written only when it changes, the speed and fps readouts at most 10 times a second;
    // every write lays the line out again: the Firefox profile's reflow each frame, 2026-10-16)
    if (now - this.#readoutAt >= READOUT_EVERY) {
      this.#readoutAt = now;
      this.#text(this.#speed, `${Math.round(s.speed)} uu/s`);
      this.#text(this.#fps, `${Math.round(s.fps)} fps`);
    }
    this.#speed.classList.toggle("supersonic", s.supersonic);
    this.#text(this.#camera, s.ballCam ? "Ball cam" : "Car cam");
    this.#text(this.#net, s.net ?? "");
    if (this.#net.hidden !== (s.net === null)) this.#net.hidden = s.net === null;
    // (the flip indicator, ours, follows the boost meter's rule)
    this.#updateFlip(this.#boostBox.hidden ? null : s.flip, s.flipReset);
    this.#updateRespawn(s.respawn);
    this.#updateVote(s.vote ?? null);
  }

  #scoreShown = false;
  #lastScore: readonly [number, number] | null = null;
  #overtimeLabel = false;
  /** When the board's intro began (performance.now(), ms; null: at rest), and what it was last drawn as */
  #introAt: number | null = null;
  #scoreDrawn = "";

  /** HUD-2/3/4: the scores, your team's on the left; the clock or "OVERTIME"; the intro when it shows; a team's glow
   *  when it scores */
  #updateScoreboard(s: HudState, team: 0 | 1): void {
    const shown = s.parts?.scoreboard ?? true;
    this.#scoreBox.hidden = !shown;
    this.#scoreBox.classList.toggle("swapped", team === 1);
    if (shown && !this.#scoreShown) this.#scoreIntro();
    this.#scoreShown = shown;
    setNumberText(this.#blue, String(s.score[0]));
    setNumberText(this.#orange, String(s.score[1]));
    const last = this.#lastScore;
    if (last) {
      for (const t of [0, 1] as const) {
        if (s.score[t] > last[t]) {
          this.#scoreArt.glow(t).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)" });
        }
      }
    }
    this.#lastScore = s.score;
    const overtime = s.overtimeLabel ?? false;
    setNumberText(this.#clock, s.clock ?? "", true);
    this.#clock.hidden = s.clock === null || overtime;
    this.#clockOvertime.hidden = !overtime;
    // (the label fades out in 0.2 s, the clock in over 0.3 s)
    if (this.#overtimeLabel && !overtime && s.clock !== null) this.#clock.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    if (!this.#overtimeLabel && overtime) this.#clockOvertime.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    this.#overtimeLabel = overtime;
    // (the board's pose, its intro's then at rest: drawn when that, its sides or the text shown change)
    const since = this.#introAt === null ? SCORE_INTRO_END : (performance.now() - this.#introAt) / 1000;
    if (since >= SCORE_INTRO_END) this.#introAt = null;
    const pose = since >= SCORE_INTRO_END ? SCOREBUG_REST : scoreIntroPose(since);
    const drawn = [pose.drop, pose.tilt, pose.turn, pose.opacity, team, this.#clock.hidden, overtime].join();
    if (shown && drawn !== this.#scoreDrawn) {
      this.#scoreDrawn = drawn;
      this.#scoreArt.draw(pose, team === 1);
      this.#scoreTilt.style.opacity = pose.opacity < 1 ? pose.opacity.toFixed(4) : "";
    }
    if (!shown) this.#scoreDrawn = "";
  }

  /** HUD-4's intro, 1 s after it shows (src/ui/scorebug.ts scoreIntroPose: down 20, tilting from 75 degrees and fading
   *  in, the score views turning from 60 degrees), drawn each frame */
  #scoreIntro(): void {
    this.#introAt = performance.now();
  }

  #boostTarget = -1;
  #boostFrom = 0;
  #boostSince = 0;

  /** The fuel gauge (ours, src/ui/fuelGauge.ts): the number tweens to its new value over 0.2 s, the needle following on
   *  its damped spring; an increase brightens the needle and the arc; the number team-coloured or plain; "full" glowing
   *  at 100 (the class `max`), "low" at 15 or under */
  #updateBoost(boost: number, team: 0 | 1, shown: boolean, now: number): void {
    this.#boostBox.hidden = !shown;
    const target = boostShown(boost);
    const displayedNow = this.#boostDisplayed(now);
    if (target !== this.#boostTarget) {
      if (this.#boostTarget >= 0 && target > this.#boostTarget && shown) this.#boostArt.flash();
      this.#boostFrom = this.#boostTarget < 0 ? target : displayedNow;
      this.#boostTarget = target;
      this.#boostSince = now;
    }
    const value = Math.round(this.#boostDisplayed(now));
    setNumberText(this.#boostValue, String(value));
    this.#boostArt.set(target, now);
    const teamColoured = this.#ui?.teamColoredBoost ?? true;
    this.#boostBox.classList.toggle("team-1", teamColoured && team === 1);
    this.#boostBox.classList.toggle("plain", !teamColoured);
    this.#boostBox.classList.toggle("max", value >= 100);
    this.#boostBox.classList.toggle("low", boostLow(value));
  }

  #boostDisplayed(now: number): number {
    const t = Math.min(1, (now - this.#boostSince) / 0.2);
    return this.#boostFrom + (this.#boostTarget - this.#boostFrom) * (1 - (1 - t) * (1 - t));
  }

  /** The centre message: the standing one, else the last said for 4 s, fading in 0.3 s; shrunk to fit the stage */
  #updateMessage(standing: string | null, now: number, width: number): void {
    const said = this.#said;
    const age = said ? now - said.at : Infinity;
    const text = standing ?? (age < MESSAGE_SECONDS + MESSAGE_FADE ? (said?.text ?? "") : "");
    const el = this.#message;
    el.hidden = text === "";
    el.classList.toggle("gone", standing === null && age >= MESSAGE_SECONDS);
    if (text !== this.#messageText) {
      this.#messageText = text;
      el.textContent = text;
      el.style.fontSize = "";
      // (too wide: smaller, from its size as set, the stand-in font's scale in it)
      if (text !== "" && el.scrollWidth > width - 80) el.style.fontSize = `${String((parseFloat(getComputedStyle(el).fontSize) * (width - 80)) / el.scrollWidth)}px`;
    }
    if (this.#popMessage && text !== "") {
      el.animate(
        [
          { transform: "scale(1.4)", filter: "brightness(2.5)" },
          { transform: "scale(1)", filter: "brightness(1)" },
        ],
        { duration: 600, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
    }
    this.#popMessage = false;
  }

  #replayGoal = "";

  /** HUD-11: the replay's banner; its goal panel staggered in, 0.25 s apart */
  #updateReplay(r: ReplayHud | null): void {
    this.#replay.hidden = r === null;
    if (r === null) {
      this.#replayGoal = "";
      return;
    }
    if (r.prompt === null) clearPrompt(this.#replayPrompt);
    else renderPrompt(this.#replayPrompt, r.prompt, "Skip");
    this.#replayWaiting.textContent = r.waiting ?? "";
    const key = JSON.stringify(r.goal);
    if (key === this.#replayGoal) return;
    this.#replayGoal = key;
    const rows: HTMLElement[] = [];
    const row = (className: string, text: string): HTMLElement => {
      const e = document.createElement("div");
      e.className = className;
      e.textContent = text;
      rows.push(e);
      return e;
    };
    const goal = r.goal;
    const named = (className: string, who: { readonly name: string; readonly team: number }, icon = ""): HTMLElement => {
      const e = row(`${className} team-${String(who.team === 1 ? 1 : 0)}`, "");
      e.innerHTML = icon;
      const name = document.createElement("bdi");
      name.textContent = who.name;
      e.append(name);
      return e;
    };
    // (an own goal: no caption, scorer or assist; the time and the speed still: HT-6)
    if (goal?.scorer) {
      row("replay-caption", "Scored By");
      named("replay-scorer", goal.scorer);
      if (goal.assister) named("replay-assist", goal.assister, ICONS.assist);
    }
    if (goal && goal.time !== null) row("replay-time", "").innerHTML = `${ICONS.time}<span>${goal.time}</span>`;
    if (goal?.speed) {
      const speed = row("replay-speed", "");
      speed.innerHTML = ICONS.speed;
      const value = document.createElement("span");
      value.textContent = String(goal.speed.value);
      const unit = document.createElement("small");
      unit.textContent = ` ${goal.speed.unit}`;
      speed.append(value, unit);
    }
    rows.forEach((e, i) => {
      e.style.animationDelay = `${String(i * 0.25)}s`;
    });
    this.#replayInfo.replaceChildren(...rows);
  }

  #lastVote: VoteHud | null = null;

  /** (shown at once, faded out in 0.3 s, its last text kept while it fades; the bar flashes at each new vote) */
  #updateVote(v: VoteHud | null): void {
    this.#vote.classList.toggle("shown", v !== null);
    const last = this.#lastVote;
    this.#lastVote = v;
    if (v === null) return;
    if (voteFlashes(last, v)) this.#voteFill.animate([{ filter: "brightness(2.5)" }, { filter: "none" }], { duration: 400, easing: "ease-out" });
    this.#voteTally.textContent = v.tally;
    this.#voteTime.textContent = v.time;
    this.#voteFill.style.width = `${String(v.fill * 100)}%`;
    this.#voteHint.textContent = v.instructions ?? "";
    this.#voteHint.hidden = v.instructions === null;
  }

  /** HUD-20 (RH1): the bars at the pick's share, orange from 60 %; the picked side glowing, its spot lit; each side's
   *  prompt, its key the active device's ("[A] - RESPAWN LEFT" for a key, the pad's icon) */
  #updateRespawn(r: RespawnHud | null): void {
    if (this.#respawn.hidden !== (r === null)) this.#respawn.hidden = r === null;
    if (r === null) return;
    this.#respawn.style.setProperty("--respawn-pct", String(r.pct / 100));
    this.#respawn.classList.toggle("late", respawnLate(r.pct));
    for (const side of ["left", "right"] as const) {
      const prompt = side === "left" ? this.#respawnLeft : this.#respawnRight;
      const group = prompt.parentElement;
      group?.classList.toggle("picked", r.side === side);
      group?.querySelectorAll<HTMLElement>(".respawn-spots i").forEach((spot) => {
        spot.classList.toggle("lit", r.side === side && (spot.dataset["spot"] === "inner") === r.inner);
      });
      const key = r.keys[side];
      const drawn = key ? `${key.kind}|${key.kind === "mouse" ? String(key.button) : key.text}` : "-";
      if (drawn === this.#respawnDrawn[side]) continue;
      this.#respawnDrawn[side] = drawn;
      const text = RESPAWN_TEXT[side];
      if (!key) prompt.replaceChildren(document.createTextNode(text));
      else if (key.kind === "word") prompt.replaceChildren(document.createTextNode(`[${key.text}] - ${text}`));
      else prompt.replaceChildren(glyphElement(key), document.createTextNode(` ${text}`));
    }
  }

  #updateFlip(dodge: Dodge | null, reset: boolean): void {
    this.#flip.hidden = dodge === null;
    if (dodge === null) return;
    // The lamp: lit while a dodge is there (amber; gold from a flip reset), dim on the wheels, dark once spent; the
    // window's seconds on its readout (and in words, for the page's readers and the tests)
    const state = dodge.kind === "free" && dodge.reset ? "reset" : dodge.kind;
    if (this.#flip.dataset["state"] !== state) this.#flip.dataset["state"] = state;
    const seconds = dodge.kind === "window" ? dodge.remaining.toFixed(1) : null;
    this.#flipLamp.digits(seconds);
    // (the page's text only when it changes: not rewritten every frame, RV-492)
    const detail = seconds === null ? "" : `${seconds} s`;
    if (this.#flipDetail.textContent !== detail) this.#flipDetail.textContent = detail;
    const label = dodge.kind === "spent" ? "No flip" : dodge.kind === "ground" ? "Flip (on the ground)" : seconds === null ? "Flip" : `Flip, ${seconds} s left`;
    if (this.#flip.getAttribute("aria-label") !== label) this.#flip.setAttribute("aria-label", label);
    // (a flip reset: the lamp flickers bright, then holds gold; the game's own sign is the effect under the car, not
    // text: render/flipResetFx.ts, HUD-19)
    if (reset) this.#flipLamp.flicker();
  }

}
