// Matchmaking as the player sees it (notes/matchmaking.md, v1 queue checklist; MM-4..14): a search's state and its
// summary (Connecting, Searching, Joining, Failed), the message log's timeline, "Joining in 3, 2, 1" with a beep each,
// then the claim: the match ticket kept for the match page, which the page is sent to. The search itself is
// src/net/matchmaker.ts (the accounts service's matchmaker: notes/matchmaking.md, the central matchmaker); the panel
// and banner src/ui/searchView.ts. The words are the game's (cleared verbatim: the user's
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
  /** The log at 30 s searching one region of several (MoreRegions: MM-8; cleared for when we search more regions) */
  moreRegions: "TIP: If you search in more regions you may find a match faster.",
} as const;

/** m:ss */
function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, "0")}`;
}

/** Our own words: the playlists, the lines for a cancelled match, a failed search and a refused one (the game has none
 *  for our no-show rule, RV-367) */
export const PLAYLISTS = [
  { teamSize: 1, name: "1v1" },
  { teamSize: 2, name: "2v2" },
  { teamSize: 3, name: "3v3" },
] as const;
export const OWN_SEARCH_TEXT = {
  notAllJoined: "Not every player joined the match. Searching again.",
  matchGone: "The match was no longer there. Searching again.",
  failedPrefix: "Search failed:",
  /** Another tab of this browser searched: this one's search ended (RV-460: our words, plain) */
  replaced: "You started searching in another tab.",
  /** That search's summary: ended, not failed (RV-491) */
  ended: "Ended",
  cooldown: (seconds: number): string =>
    `Your last match was cancelled because you didn't join it in time or left before it started. You can search again in ${clock(seconds)}.`,
} as const;

export type SearchStatus = "connecting" | "searching" | "joining" | "failed" | "ended";

/** A log line and its colour (MM-8: status blue, warning red, countdown yellow) */
export interface LogLine {
  readonly text: string;
  readonly kind: "status" | "warning" | "countdown";
}

/** The log's timeline lines due at this many seconds of searching (MM-8, the lines our matchmaker's work matches);
 *  `moreRegions`: one region searched of several (the MoreRegions tip at 30 s) */
export function timelineLines(seconds: number, moreRegions = false): readonly LogLine[] {
  const lines: LogLine[] = [];
  if (seconds >= 5) lines.push({ text: SEARCH_TEXT.findingBestMatch, kind: "status" });
  if (moreRegions && seconds >= 30) lines.push({ text: SEARCH_TEXT.moreRegions, kind: "status" });
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

/** A search back from a match cancelled for someone else (RV-367): how long it had searched (its clock goes on; the
 *  matchmaker keeps its place itself) */
export interface SearchBack {
  readonly searchedFor: number;
}

/** A match the matchmaker found: its id, its server (its address, host:port), this player's match ticket for their
 *  seat, the playlist that matched (team size) and its map (src/render/themes/index.ts THEMES) */
export interface FoundMatch {
  readonly id: bigint;
  readonly server: string;
  readonly ticket: string;
  readonly playlist: number;
  readonly map: number;
}

export interface SearchHandlers {
  searching(): void;
  /** A match found */
  found(match: FoundMatch): void;
  failed(reason: string): void;
  /** A line for the log while the search goes on (a region dropped, another still searching) */
  warning?(text: string): void;
  /** The server refused it (its reason), before `failed` with the words */
  refused?(reason: number): void;
  /** Refused: this account stalled a match; it may search again in this many seconds (RV-367) */
  cooldown(seconds: number): void;
  /** A newer search of this account (another tab) took this one's place (RV-460) */
  replaced(): void;
}

/** A search session's ends: closed at once (Cancel Search: the promise settles once the service has its cancel), or
 *  closed and its last answer awaited (the page going) */
export interface SearchSession {
  cancel(): Promise<void>;
  finish(): Promise<void>;
}

export interface MatchmakingPorts {
  /** Opens a search of these playlists (team sizes) */
  readonly search: (playlists: readonly number[], handlers: SearchHandlers) => SearchSession;
  /** The start, cancel and countdown sounds (MM-12) */
  readonly sound: (cue: "start" | "cancel" | "countdown") => void;
  /** The join's end: the match claimed in the match page; the playlists searched (Play Again's); how long the search had
   *  run (s: a cancelled match's search goes on from there) */
  readonly join: (match: FoundMatch, playlists: readonly number[], searchedFor: number) => void;
  /** Cancel Search during "Joining in": the seat given up at once (claimed and left: the match is cancelled now, its
   *  other players search again, not after the wait: RV-355) */
  readonly decline: (match: FoundMatch) => void;
  /** Whether a search now searches one region of several (the log's MoreRegions tip) */
  readonly moreRegions?: () => boolean;
}

/** One search at a time, from Find Match to the join, a failure or Cancel Search. `frame(now)` runs the log's timeline
 *  (s); the join's countdown runs on timers, so a hidden tab (no frames) still claims on time (RV-354) */
export class Matchmaking {
  #state: SearchViewState | null = null;
  #playlists: readonly number[] = [];
  #session: SearchSession | null = null;
  /** The page going: the search finishing (RV-443), whether a match was found meanwhile */
  #finishing: Promise<boolean> | null = null;
  #searchingSince: number | null = null;
  /** A returning search's time before (s) */
  #searchedBefore = 0;
  /** The match found, till its join */
  #found: FoundMatch | null = null;
  /** One region of several searched (the MoreRegions tip) */
  #moreRegions = false;
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
    return this.#state !== null && this.#state.status !== "failed" && this.#state.status !== "ended";
  }

  get playlists(): readonly number[] {
    return this.#playlists;
  }

  /** Find Match (or Play Again): a new search of the playlists; `warning`: a line to start the log with; `back`: a search
   *  back from a match cancelled for someone else (RV-367). Ignored while a search runs (MM-2: SearchInProgress; its
   *  place in the queue stays): false then */
  start(playlists: readonly number[], warning?: string, back?: SearchBack): boolean {
    if (this.searching) return false;
    this.#stop();
    this.#playlists = [...playlists];
    this.#extra = warning === undefined ? [] : [{ text: warning, kind: "warning" }];
    this.#searchingSince = null;
    this.#searchedBefore = Math.max(0, back?.searchedFor ?? 0);
    this.#found = null;
    this.#failedAt = null;
    this.#moreRegions = this.ports.moreRegions?.() ?? false;
    this.#set("connecting");
    this.ports.sound("start");
    const handlers: SearchHandlers = {
      searching: () => {
        if (this.#state?.status !== "connecting") return;
        this.#searchingSince = this.#now - this.#searchedBefore;
        this.#set("searching");
      },
      found: (match) => {
        if (!this.searching) return;
        this.#session = null;
        this.#found = match;
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
        // (a finishing search's end isn't a failure: the next page searches)
        if (this.#finishing || (this.#state?.status !== "connecting" && this.#state?.status !== "searching")) return;
        this.#session = null;
        this.#extra.push({ text: `${OWN_SEARCH_TEXT.failedPrefix} ${reason}`, kind: "warning" });
        this.#failedAt = this.#now;
        this.#set("failed");
      },
      // (a region dropped while another searches: its line as given, not "Search failed": the search goes on, RX43C)
      warning: (text) => {
        const status = this.#state?.status;
        if (this.#finishing || (status !== "connecting" && status !== "searching")) return;
        this.#extra.push({ text, kind: "warning" });
        this.#set(status);
      },
      // (another tab's search took this one's place: said plainly, the search over here; the line stays till Cancel
      // Search or a new search)
      replaced: () => {
        if (this.#finishing || (this.#state?.status !== "connecting" && this.#state?.status !== "searching")) return;
        this.#session = null;
        this.#extra.push({ text: OWN_SEARCH_TEXT.replaced, kind: "status" });
        this.#failedAt = null;
        this.#set("ended");
      },
      // (the refusal stays until Cancel Search or a new search: its wait is minutes, the line must be read)
      cooldown: (seconds) => {
        if (this.#finishing || (this.#state?.status !== "connecting" && this.#state?.status !== "searching")) return;
        this.#session = null;
        this.#extra.push({ text: OWN_SEARCH_TEXT.cooldown(seconds), kind: "warning" });
        this.#failedAt = null;
        this.#set("failed");
      },
    };
    this.#session = this.ports.search(this.#playlists, handlers);
    return true;
  }

  /** Cancel Search (MM-10): the session closed, the cancel sound, the panel and banner gone; during "Joining in" the
   *  slot given up at once (RV-355) */
  cancel(): void {
    void this.cancelled();
  }

  /** The same, settled once the service has the cancel: an account about to sign out or go first cancels its search
   *  while its session still stands (else it would go on, matchable, till it lapsed: the flow audit's 6) */
  cancelled(): Promise<void> {
    if (this.#state === null) return Promise.resolve();
    const searching = this.searching;
    const found = this.#state.status === "joining" ? this.#found : null;
    const delivered = this.#session?.cancel() ?? Promise.resolve();
    this.#session = null;
    this.#stop();
    this.#state = null;
    if (found !== null) this.ports.decline(found);
    if (searching) this.ports.sound("cancel");
    return delivered;
  }

  /** The page going elsewhere (another map) with this search: the search finished (its session closed and its last
   *  answer awaited), true if a match was found meanwhile (the join goes on: the page follows it), else false (no
   *  search left, no cancel sound: the next page searches) (RV-443) */
  finish(): Promise<boolean> {
    if (this.#finishing) return this.#finishing;
    const status = this.#state?.status;
    if (status === "joining") return Promise.resolve(true);
    if (status !== "connecting" && status !== "searching") return Promise.resolve(false);
    const finishing = (this.#session?.finish() ?? Promise.resolve()).then(() => {
      this.#finishing = null;
      if (this.#state?.status === "joining") return true;
      this.#stop();
      this.#state = null;
      return false;
    });
    this.#finishing = finishing;
    return finishing;
  }

  #stop(): void {
    void this.#session?.cancel();
    this.#session = null;
    for (const t of this.#timers.splice(0)) clearTimeout(t);
    this.#found = null;
  }

  #countdown(n: number): void {
    this.#extra.push({ text: `${SEARCH_TEXT.joiningIn} ${String(n)}`, kind: "countdown" });
    this.ports.sound("countdown");
    this.#set("joining");
  }

  #join(): void {
    const found = this.#found;
    const searchedFor = this.#searchingSince === null ? this.#searchedBefore : this.#now - this.#searchingSince;
    this.#timers = [];
    this.#found = null;
    this.#state = null;
    if (found !== null) this.ports.join(found, this.#playlists, searchedFor);
  }

  #set(status: SearchStatus): void {
    const timeline = this.#searchingSince === null ? [] : timelineLines(this.#now - this.#searchingSince, this.#moreRegions);
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
