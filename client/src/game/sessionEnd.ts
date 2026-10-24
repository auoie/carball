// How a match session ends and when the idle warning shows (notes/matchmaking.md MM-36..38, MM-41): pure, for the
// online game (src/game/online.ts) and its tests.
import { KICK_IDLE, KICK_NOT_ALL_JOINED, type MatchPhase } from "../net/protocol";
import { matchOver } from "./matchSequence";

/** How a match session ended: kicked for being idle, its match cancelled before the start (not every reserved player
 *  joined), the match over, or the connection lost */
export type SessionEnd = "idle" | "notAllJoined" | "ended" | "lost";

/** Why the session ended, from the server's kick (KICK_*: null without one) and the phase it ended in: once the match is
 *  over (its podium, its end screen: the server lets a finished queue match go), ended, whoever closed it (the page left
 *  by a reload, Back or another address too: no lost connection told of a match that was over, the user's report) */
export function sessionEndReason(kicked: number | null, phase: MatchPhase | undefined): SessionEnd {
  if (kicked === KICK_IDLE) return "idle";
  if (kicked === KICK_NOT_ALL_JOINED) return "notAllJoined";
  // (any other kick, one this page doesn't know too: the server ended it, not a lost connection: RV-485)
  if (kicked !== null) return "ended";
  return matchOver(phase) ? "ended" : "lost";
}

/** The idle warning's tip (MM-36): while the server flags it, during play (0:00 too), with the car's camera (not in a
 *  goal replay), connected */
export function idleTipShown(warning: boolean, phase: MatchPhase | undefined, replaying: boolean, disconnected: boolean): boolean {
  return warning && (phase === "active" || phase === "timeUp") && !replaying && !disconnected;
}
