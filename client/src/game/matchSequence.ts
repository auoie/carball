// The match's start and end as the player sees them (notes/match-intro-outro.md): the joining camera (CAM-30), the
// views at the end (the pre-podium hold and fade, CAM-35; the podium's dolly, CAM-36), the winner banner's words
// (MIO-18/19), the screen's dimming (MIO-20), and which HUD parts each phase shows (MIO-5/17). Pure: the online game
// and the HUD draw from it.
import type { CameraView } from "../camera/carballCamera";
import type { MatchPhase, MatchState } from "../net/protocol";
import type { Vec3 } from "../math/vec";
import { TEAM_NAMES } from "./matchStats";

/** The match is over: the podium phases and the end screen */
export function matchOver(phase: MatchPhase | undefined): boolean {
  return phase === "prePodium" || phase === "podium" || phase === "finished";
}

const UU_PER_DEGREE = 65536 / 360;
const rotatorRadians = (units: number): number => (units / 65536) * 2 * Math.PI;

function view(position: Vec3, pitch: number, yaw: number, horizontalFov: number): CameraView {
  const cp = Math.cos(pitch);
  const forward = { x: cp * Math.cos(yaw), y: cp * Math.sin(yaw), z: Math.sin(pitch) };
  const up = { x: -Math.sin(pitch) * Math.cos(yaw), y: -Math.sin(pitch) * Math.sin(yaw), z: cp };
  return { position, forward, up, horizontalFov };
}

/** CAM-30: Stadium_P's CameraActor_7, the side view a joining player sees before their car (FOV 100) */
export const WAITING_VIEW: CameraView = view({ x: 3974.73, y: 0, z: 342.39 }, rotatorRadians(364), rotatorRadians(32768), 100);
/** It shows at least this long while the match waits (MinExecutionTime), once per camera */
export const WAITING_MIN_SECONDS = 3;

/** CAM-35: the pre-podium view holds; it fades to black over 0.25 s from 2.5 s (FadeOutDelay, FadeOutDuration) */
export const PRE_PODIUM_FADE = { delay: 2.5, duration: 0.25 } as const;
/** CAM-36: the podium cuts in from black over 0.25 s */
export const PODIUM_FADE_IN = 0.25;
/** MIO-12: the winners' goal explosion, 0.6 s into the podium (WinnersExplosionDelaySeconds) */
export const WINNERS_EXPLOSION_DELAY = 0.6;
/** MIO-2: the arena fades in from black over 1 s when it first draws */
export const LOAD_FADE_IN = 1;

/** The winning team's own goal (MIO-12: the explosion's place, the podium's anchor): blue defends −y */
export function winnersGoal(winner: number): Vec3 {
  return { x: 0, y: winner === 1 ? 5120 : -5120, z: 312 };
}

/** The podium's spots (InitPodiumCars, the server's PODIUM_SPOTS: MIO-11): blue's, orange's point-mirrored */
const PODIUM_SPOTS: readonly (readonly [number, number])[] = [
  [-40, -1670],
  [-200, -1795],
  [150, -1820],
  [-115, -2020],
];

/** Where the podium's `count` cars stand (the winners by MVPSort take the spots in order; 1 to 4) */
export function podiumSpots(winner: number, count: number): Vec3[] {
  const side = winner === 1 ? -1 : 1;
  return PODIUM_SPOTS.slice(0, Math.min(4, Math.max(1, count))).map(([x, y]) => ({ x: x * side, y: y * side, z: 17 }));
}

/**
 * CAM-36, the winners-explosion variant: the podium cars' mean (their spots: RV-273), from the field side
 * toward the winners' goal, 2° down (the offset rotation in whole degrees), the distance easing from 600 to 400
 * (d = 400 + 200 e^(−1.2 t)), FOV 70, the focus 60 up. `t`: real seconds since the podium began
 */
export function podiumView(cars: readonly Vec3[], winner: number, t: number): CameraView {
  const n = Math.max(1, cars.length);
  const focus = { x: cars.reduce((s, c) => s + c.x, 0) / n, y: cars.reduce((s, c) => s + c.y, 0) / n, z: 60 };
  const goal = winnersGoal(winner);
  const yaw = Math.round(Math.atan2(goal.y, goal.x) * (32768 / Math.PI)); // (the goal's direction as a rotator)
  const pitch = Math.trunc(-2 * UU_PER_DEGREE); // (GetOffsetRotation: whole degrees times 182.044, truncated)
  const distance = 400 + 200 * Math.exp(-1.2 * Math.max(0, t));
  const v = view(focus, rotatorRadians(pitch), rotatorRadians(yaw), 70);
  return { ...v, position: { x: focus.x - v.forward.x * distance, y: focus.y - v.forward.y * distance, z: focus.z - v.forward.z * distance } };
}

/** MIO-18/19's words (verbatim: UIText [Global] Winner / WinnerByForfeit, Team_TA TeamName0/1), upper-cased */
export function winnerBanner(winner: number | null, forfeit: boolean): { readonly label: string; readonly team: string; readonly side: number } | null {
  if (winner === null) return null;
  const side = winner === 1 ? 1 : 0;
  return { label: (forfeit ? "Winner by forfeit" : "Winner").toUpperCase(), team: TEAM_NAMES[side].toUpperCase(), side };
}

/**
 * MIO-20's two layers' alphas `t` real seconds into a phase: the screen filter (darkening, 0.8 at the pre-podium and
 * the end screen) and the team-tinted vignette (0.75 on the podium). Each tween runs from where the last left off
 */
export function dimming(phase: MatchPhase | undefined, t: number, from: { readonly filter: number; readonly vignette: number }): { readonly filter: number; readonly vignette: number } {
  const tween = (a: number, b: number, length: number): number => a + (b - a) * Math.min(1, Math.max(0, t) / length);
  if (phase === "prePodium" || phase === "finished") return { filter: tween(from.filter, 0.8, 1), vignette: tween(from.vignette, 0, 1) };
  if (phase === "podium") return { filter: tween(from.filter, 0, 0.5), vignette: tween(from.vignette, 0.75, 0.5) };
  return { filter: tween(from.filter, 0, 0.3), vignette: tween(from.vignette, 0, 0.3) };
}

/** MIO-5/17: what the HUD shows in a phase. The top scoreboard and the boost meter only while playing (not in the
 *  warm-up, not at the end); the held scoreboard not at the end */
/** Whether a demolished car's respawn view can show (notes/hud-menus.md HUD-20, RH1: the ticket exists in Active only,
 *  0:00 with the ball up still Active; leaving it clears the view, never freezes it: a goal and its replay, the
 *  countdown, the match's end, where the podium hides the losers' cars as demolished, the user's finding, 2026-10-16).
 *  Free play: no match phases, always */
export function respawnShown(m: Pick<MatchState, "phase"> | null | undefined): boolean {
  return m === null || m === undefined || m.phase === "active" || m.phase === "timeUp";
}

export function hudParts(phase: MatchPhase | undefined): { readonly scoreboard: boolean; readonly boost: boolean; readonly heldScoreboard: boolean } {
  const playing = phase === "countdown" || phase === "active" || phase === "postGoal" || phase === "timeUp" || phase === "replay";
  return { scoreboard: playing, boost: playing && phase !== "replay", heldScoreboard: phase !== undefined && !matchOver(phase) };
}

/** MIO-31's countdown line (UIText [EndGameMenu] NextMatchIn, verbatim) */
export const END_TEXT = {
  nextMatchIn: "Next Match In",
  ready: "Ready",
  readyDesc: "Ready for next match",
  exit: "Exit to Main Menu",
  exitDesc: "Exit to the Main Menu",
  options: "Options",
  optionsDesc: "Modify your settings",
  exitInquiry: "Are you sure you want to exit to the main menu?",
  yes: "Yes",
  no: "No",
  winner: "Winner",
  myAccolades: "My Accolades",
  /** A queue match's end (the game's ranked flow, MIO-29/31): search again, and the countdown back to the menu */
  playAgain: "Play Again",
  playAgainDesc: "Search for a new match",
  leavingIn: "Leaving In",
} as const;
