// Matchmaking as the player sees it (notes/matchmaking.md, v1 queue checklist; MM-4..14): a search's state and its
// summary (Connecting, Searching, Joining, Failed), the message log's timeline, "Joining in 3, 2, 1" with a beep each,
// then the claim: the token kept for the match page, which the page is sent to. The search session itself is
// src/net/search.ts; the panel and banner src/ui/searchView.ts. The words are the game's (cleared verbatim: the user's
// decisions, 2026-10-14), but for the playlists' names and our own lines, which are ours.

export const SEARCH_TEXT = {
  findMatch: "Find Match",
  title: "Searching...",
  cancel: "Cancel Search",
  connecting: "Connecting",
  searching: "Searching",
  joining: "Joining",
  failed: "Failed",
  joiningIn: "Joining in",
  /** The log at 5 s (FindingBestMatch) and at 150 s (WaitingForMorePlayers): MM-8 */
  findingBestMatch: "Trying to find best match...",
  waitingForMorePlayers: "Waiting for more players to start matchmaking with your preferences...",
} as const;

/** Our own words: the playlists, the lines for a cancelled match and a failed search */
export const PLAYLISTS = [
  { teamSize: 1, name: "1v1" },
  { teamSize: 2, name: "2v2" },
  { teamSize: 3, name: "3v3" },
] as const;
export const OWN_SEARCH_TEXT = {
  notAllJoined: "Not every player joined the match. Searching again.",
  matchGone: "The match was no longer there. Searching again.",
  failedPrefix: "Search failed:",
} as const;

export type SearchStatus = "connecting" | "searching" | "joining" | "failed";

/** A log line and its colour (MM-8: status blue, warning red, countdown yellow) */
export interface LogLine {
  readonly text: string;
  readonly kind: "status" | "warning" | "countdown";
}

/** The log's timeline lines due at this many seconds of searching (MM-8, the lines our matchmaker's work matches) */
export function timelineLines(seconds: number): readonly LogLine[] {
  const lines: LogLine[] = [];
  if (seconds >= 5) lines.push({ text: SEARCH_TEXT.findingBestMatch, kind: "status" });
  if (seconds >= 150) lines.push({ text: SEARCH_TEXT.waitingForMorePlayers, kind: "status" });
  return lines;
}

/** The join countdown (JoinCountdownTime 3: MM-14) */
export const JOIN_COUNTDOWN = 3;

/** What the panel and banner show */
export interface SearchViewState {
  readonly status: SearchStatus;
  readonly lines: readonly LogLine[];
}

export interface MatchmakingPorts {
  /** Opens a search session; returns its cancel */
  readonly search: (playlist: number, handlers: { searching(): void; found(token: bigint): void; failed(reason: string): void }) => () => void;
  /** The start, cancel and countdown sounds (MM-12) */
  readonly sound: (cue: "start" | "cancel" | "countdown") => void;
  /** The join's end: the token claimed in the match page */
  readonly join: (token: bigint, playlist: number) => void;
  /** Cancel Search during "Joining in": the slot given up at once (claimed and left: the match is cancelled now, its
   *  other players search again, not after the 30 s wait: RV-355) */
  readonly decline: (token: bigint) => void;
}

/** One search at a time, from Find Match to the join, a failure or Cancel Search. `frame(now)` runs the log's timeline
 *  (s); the join's countdown runs on timers, so a hidden tab (no frames) still claims on time (RV-354) */
export class Matchmaking {
  #state: SearchViewState | null = null;
  #playlist = 0;
  #cancel: (() => void) | null = null;
  #searchingSince: number | null = null;
  #token: bigint | null = null;
  #timers: ReturnType<typeof setTimeout>[] = [];
  #extra: LogLine[] = [];
  /** When a failed search's summary goes (its fade) */
  #failedAt: number | null = null;
  #now = 0;

  constructor(private readonly ports: MatchmakingPorts) {}

  /** The panel's and banner's state; null: no search */
  get state(): SearchViewState | null {
    return this.#state;
  }

  get searching(): boolean {
    return this.#state !== null && this.#state.status !== "failed";
  }

  get playlist(): number {
    return this.#playlist;
  }

  /** Find Match (or Play Again): a new search of the playlist; `warning`: a line to start the log with. Ignored while a
   *  search runs (MM-2: SearchInProgress; its place in the queue stays): false then */
  start(playlist: number, warning?: string): boolean {
    if (this.searching) return false;
    this.#stop();
    this.#playlist = playlist;
    this.#extra = warning === undefined ? [] : [{ text: warning, kind: "warning" }];
    this.#searchingSince = null;
    this.#token = null;
    this.#failedAt = null;
    this.#set("connecting");
    this.ports.sound("start");
    this.#cancel = this.ports.search(playlist, {
      searching: () => {
        if (this.#state?.status !== "connecting") return;
        this.#searchingSince = this.#now;
        this.#set("searching");
      },
      found: (token) => {
        if (!this.searching) return;
        this.#cancel = null;
        this.#token = token;
        this.#set("joining");
        this.#countdown(JOIN_COUNTDOWN);
        for (let n = JOIN_COUNTDOWN - 1; n >= 0; n--) {
          this.#timers.push(
            setTimeout(
              () => {
                if (n > 0) this.#countdown(n);
                else this.#join();
              },
              (JOIN_COUNTDOWN - n) * 1000,
            ),
          );
        }
      },
      failed: (reason) => {
        if (this.#state?.status !== "connecting" && this.#state?.status !== "searching") return;
        this.#cancel = null;
        this.#extra.push({ text: `${OWN_SEARCH_TEXT.failedPrefix} ${reason}`, kind: "warning" });
        this.#failedAt = this.#now;
        this.#set("failed");
      },
    });
    return true;
  }

  /** Cancel Search (MM-10): the session closed, the cancel sound, the panel and banner gone; during "Joining in" the
   *  slot given up at once (RV-355) */
  cancel(): void {
    if (this.#state === null) return;
    const searching = this.searching;
    const token = this.#state.status === "joining" ? this.#token : null;
    this.#stop();
    this.#state = null;
    if (token !== null) this.ports.decline(token);
    if (searching) this.ports.sound("cancel");
  }

  #stop(): void {
    this.#cancel?.();
    this.#cancel = null;
    for (const t of this.#timers.splice(0)) clearTimeout(t);
    this.#token = null;
  }

  #countdown(n: number): void {
    this.#extra.push({ text: `${SEARCH_TEXT.joiningIn} ${String(n)}`, kind: "countdown" });
    this.ports.sound("countdown");
    this.#set("joining");
  }

  #join(): void {
    const token = this.#token;
    this.#timers = [];
    this.#token = null;
    this.#state = null;
    if (token !== null) this.ports.join(token, this.#playlist);
  }

  #set(status: SearchStatus): void {
    const timeline = this.#searchingSince === null ? [] : timelineLines(this.#now - this.#searchingSince);
    this.#state = { status, lines: [...timeline, ...this.#extra] };
  }

  frame(now: number): void {
    this.#now = now;
    const state = this.#state;
    if (state === null) return;
    if (state.status === "searching") {
      this.#set("searching");
    } else if (state.status === "failed" && this.#failedAt !== null && now - this.#failedAt > 5) {
      this.#state = null; // (the summary fades: MM-6)
    }
  }
}
