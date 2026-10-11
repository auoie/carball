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
}

export interface MatchMenuState {
  readonly matchType: MatchType;
  /** The playlist's team size */
  readonly teamSize: number;
  /** The match state's bCanVoteToForfeit */
  readonly canVoteForfeit: boolean;
  /** The player's team's vote (null: none heard yet) */
  readonly vote: ForfeitVote | null;
}

/**
 * The midgame menu's match buttons (MidgameMenu, MR-7.8). A 1v1 playlist (MaxPlayers ≤ 2): "Forfeit Match" with a
 * confirm while votes are allowed (one human: the vote passes on the press), else "Leave Match". A team playlist:
 * "Vote to Forfeit" (ranked) or "Vote to Concede" with no confirm, when the playlist allows votes (bForfeitVoteAllowed:
 * casual and ranked) and they're allowed now, and the player may start one or one runs they haven't voted in; then
 * "Leave Match" with its confirm (the leave-penalty variants, "Abandon Match", come with leave penalties).
 */
export function matchMenuItems(s: MatchMenuState): MatchMenuItem[] {
  const leave: MatchMenuItem = { action: "leave", label: VOTE_TEXT.leaveMatch, confirm: VOTE_TEXT.leaveMatchInquiry, danger: false };
  if (s.teamSize <= 1) {
    return [s.canVoteForfeit ? { action: "forfeit", label: VOTE_TEXT.forfeitMatch, confirm: VOTE_TEXT.forfeitMatchInquiry, danger: true } : leave];
  }
  const vote = s.vote;
  const mayVote = vote !== null && (vote.canStart || (vote.state === "running" && !vote.voted));
  const items: MatchMenuItem[] = [];
  if (s.matchType !== "private" && s.canVoteForfeit && mayVote) {
    items.push({ action: "vote", label: voteLabel(s.matchType), confirm: null, danger: false });
  }
  items.push(leave);
  return items;
}

/** The HUD's vote widget (VoteToForfeitView) */
export interface VoteHud {
  /** "Vote to Concede 1/3" */
  readonly tally: string;
  /** The time left: 1 .. 0 over the vote's 20 s (the progress bar) */
  readonly fill: number;
  /** m:ss */
  readonly time: string;
  /** "Press Esc to Vote", until the player votes (null: not shown) */
  readonly instructions: string | null;
}

/** The widget for the player's team's vote: shown while it runs (it fades out at its end, passed or failed, and when
 *  it's gone); null when there's none to show. `menuKey`: the key that opens the menu */
export function voteHud(vote: ForfeitVote | null, matchType: MatchType, menuKey: string): VoteHud | null {
  if (vote?.state !== "running") return null;
  const seconds = Math.max(0, Math.min(VOTE_SECONDS, vote.secondsLeft));
  return {
    tally: tally(matchType, vote.yes, vote.required),
    fill: seconds / VOTE_SECONDS,
    time: `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`,
    instructions: vote.voted ? null : pressTo(menuKey, "Vote"),
  };
}
