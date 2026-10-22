// Forfeit votes as the player sees them (notes/match-rules-audit.md MR-7.8): the midgame menu's forfeit, vote and leave
// buttons, and the HUD's vote widget (VoteToForfeitView). The text is the game's (UIText.int, cleared to ship verbatim).
import type { ForfeitVote, MatchType } from "../net/protocol";

/** A vote's length (ForfeitVoteArchetype.TimeRemaining) */
const VOTE_SECONDS = 20;

/** [Global] and [ModalPopups] strings */
export const VOTE_TEXT = {
  voteForfeit: "Vote to Forfeit",
  voteConcede: "Vote to Concede",
  forfeitMatch: "Forfeit Match",
  leaveMatch: "Leave Match",
  forfeitMatchInquiry: "Are you sure you want to forfeit the match?",
  leaveMatchInquiry: "Are you sure you want to quit the match?",
  // (the leave penalty's: [Global] AbandonMatch, Warning, [ModalPopups] LeaverPenaltyInquiry, RV-715)
  abandonMatch: "Abandon Match",
  warning: "Warning",
  leaverPenaltyInquiry: "Abandoning a ranked game will temporarily ban you from matchmaking. ARE YOU SURE?",
} as const;

/** VoteToForfeitCount / VoteToConcedeCount: "Vote to Forfeit {0?Number}/{1?Total}" */
function tally(matchType: MatchType, yes: number, required: number): string {
  return `${voteLabel(matchType)} ${String(yes)}/${String(required)}`;
}

/** A ranked match votes to forfeit, the others to concede (casual; a private match isn't ranked) */
export function voteLabel(matchType: MatchType): string {
  return matchType === "ranked" ? VOTE_TEXT.voteForfeit : VOTE_TEXT.voteConcede;
}

/** VoteInstructions / SkipInstructions: "Press {0?KeyBinding} to Vote" */
export function pressTo(key: string, action: "Vote" | "Skip"): string {
  return `Press ${key} to ${action}`;
}

export type MatchAction = "vote" | "forfeit" | "leave";

export interface MatchMenuItem {
  readonly action: MatchAction;
  readonly label: string;
  /** Asked first, yes or no (null: none) */
  readonly confirm: string | null;
  /** Drawn red (the 1v1 forfeit) */
  readonly danger: boolean;
  /** Its question's title and warning style (WarningModalPopup: red YES and NO), the leave penalty's (none: a plain one) */
  readonly warning?: string;
}

export interface MatchMenuState {
  readonly matchType: MatchType;
  /** The playlist's team size */
  readonly teamSize: number;
  /** The match state's bCanVoteToForfeit */
  readonly canVoteForfeit: boolean;
  /** The player's team's vote (null: none heard yet) */
  readonly vote: ForfeitVote | null;
  /** The lobby's leave penalty (bHasLeaveMatchPenalty: every seat's player here, no winner yet; LV1: the first leaver
   *  banned) */
  readonly leavePenalty: boolean;
}

/**
 * The midgame menu's match button (MidgameMenu m#9108, getLeaveMatchButtonData: one slot, MR-7.8, RV-236). A 1v1
 * playlist (MaxPlayers ≤ 2): "Forfeit Match", red, with a confirm, while votes are allowed (one human: the vote passes on
 * the press), else "Leave Match". A team playlist: "Vote to Forfeit" (ranked) or "Vote to Concede" with no confirm, red
 * while a vote runs, when the playlist allows votes (bForfeitVoteAllowed: casual and ranked), they're allowed now, and
 * the player may start one or one runs they haven't voted in; else "Leave Match" with its confirm. In a ranked lobby with
 * the leave penalty, "Abandon Match" with the penalty's warning instead (shouldDisplayAbandon, m#9114: no vote they may
 * still take part in): a team playlist's first, a 1v1's after its forfeit (RV-715)
 */
export function matchMenuItems(s: MatchMenuState): MatchMenuItem[] {
  const leave: MatchMenuItem = { action: "leave", label: VOTE_TEXT.leaveMatch, confirm: VOTE_TEXT.leaveMatchInquiry, danger: false };
  const vote = s.vote;
  const running = vote?.state === "running";
  const abandon = s.leavePenalty && s.matchType === "ranked" && ((running && vote.voted) || (!running && !(vote?.canStart ?? false)) || !s.canVoteForfeit);
  const abandonItem: MatchMenuItem = {
    action: "leave",
    label: VOTE_TEXT.abandonMatch,
    confirm: VOTE_TEXT.leaverPenaltyInquiry,
    danger: false,
    warning: VOTE_TEXT.warning,
  };
  if (s.teamSize <= 1) {
    if (s.canVoteForfeit) return [{ action: "forfeit", label: VOTE_TEXT.forfeitMatch, confirm: VOTE_TEXT.forfeitMatchInquiry, danger: true }];
    return [abandon ? abandonItem : leave];
  }
  if (abandon) return [abandonItem];
  const mayVote = vote !== null && (vote.canStart || (running && !vote.voted));
  if (s.matchType !== "private" && s.canVoteForfeit && mayVote) return [{ action: "vote", label: voteLabel(s.matchType), confirm: null, danger: running }];
  return [leave];
}

/** The HUD's vote widget (VoteToForfeitView, HUD m#9508-9519) */
export interface VoteHud {
  /** "Vote to Concede 1/3" */
  readonly tally: string;
  /** The votes so far (a new one flashes the bar) */
  readonly yes: number;
  /** The bar: yes / required */
  readonly fill: number;
  /** m:ss of its 20 s */
  readonly time: string;
  /** "Press Esc to Vote", until the player votes, while it runs (null: not shown) */
  readonly instructions: string | null;
  /** It runs (else it's a finished one's 5 s) */
  readonly running: boolean;
}

/** The bar flashes at each new yes, from 0 for a vote that just started, one replacing a finished vote still shown
 *  too (RV-268); `last`: the widget the frame before (null: none) */
export function voteFlashes(last: VoteHud | null, now: VoteHud): boolean {
  const fresh = now.running && !(last?.running ?? false);
  return now.yes > (fresh ? 0 : (last?.yes ?? 0));
}

/** The widget for the player's team's vote: shown at once while it runs and through its 5 s after (passed or failed),
 *  until it's gone or the match ends, then faded out (RV-237); null when there's none. `menuKey`: the key that opens the
 *  menu */
export function voteHud(vote: ForfeitVote | null, matchType: MatchType, menuKey: string, matchEnded = false): VoteHud | null {
  if (vote === null || vote.state === "none" || matchEnded) return null;
  const seconds = Math.max(0, Math.min(VOTE_SECONDS, vote.secondsLeft));
  return {
    tally: tally(matchType, vote.yes, vote.required),
    yes: vote.yes,
    fill: vote.required > 0 ? Math.min(1, vote.yes / vote.required) : 0,
    time: `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`,
    instructions: vote.state === "running" && !vote.voted ? pressTo(menuKey, "Vote") : null,
    running: vote.state === "running",
  };
}
