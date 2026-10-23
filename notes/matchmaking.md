# Casual matchmaking: client view (MM-1 … MM-48)

Static session, sub-agent MM1, 2026-10-14; live build 2026-10-06. Scope (user decision): free play plus casual online
matchmaking, playlists 1v1 / 2v2 / 3v3, no ranks, guest names, no accounts. Psyonix's matchmaker (PsyNet) is not in
the exe: rows say what the client shows and enforces, and mark the rest **[PsyNet]** (server-side, unknowable).

**Scope, REVISED 2026-10-18 (the user, via tmp-7f): ranked only, sign-in required.**
- Online play is **ranked only**: 1v1, 2v2 and 3v3, every match rated (Glicko-2, provisional for new accounts). There
  is no casual playlist, and no ranked gate.
- **Sign-in (Google or Steam) is required for any online match**: no guest names, and the browser key is no identity
  online (notes/accounts.md).
- The offline modes (free play, custom training, Play vs Bots) stay without sign-in.
- The rows below were researched for casual and stay as reference: where they say casual, guests or "no accounts",
  this supersedes them.
- Ranked matchmaking itself (pairing searchers by rating, placements, ranks shown) is its own design, after
  notes/accounts.md.

**Leavers, rejoining and ratings: the game's (LV1, 2026-10-18; the user's rule "ranked follows the game"; supersedes
2026-10-16's items 1 and 2 below and this note's earlier 2026-10-18 answers where they differ).** The static session's
lookup of the live build (out/bsim/agents/LV1/, local). The game server decides *when* a penalty applies; the ladder and
anything rating-side beyond what's submitted is PsyNet's, unknowable, so Carball picks its own (marked **ours**).
- **Ratings at the end** (`SubmitMatch`, only with a winner): every player whose last team won is a winner, the rest
  losers, each flagged if they quit (`bQuitter`), with their time played.
  - A leaver gets **their team's result**, flagged a quitter; an **idle kick is a leave**.
  - A teammate left behind: an ordinary result, no protection. When the other team leaves, everyone on the winning team
    gains.
  - **Forfeit:** the other team wins; the forfeiters are ordinary losers, not quitters, and get no ban (a vote or a 1v1
    Forfeit removes nobody). A team left with no humans forfeits at once (0.01 s); a lone human can forfeit with one
    press once votes are allowed (ranked: after 90 s of clock).
  - **No contest** (the match ends with no winner: everyone left, cancelled before the start, ended by the server):
    nothing is submitted, nobody's rating changes. This replaces the earlier "both teams kicked, or nobody still active":
    the game has no activity condition.
  - Whether being a quitter dampens the rating change: unknown in the game. **Ours: no** (the user: "if a team wins,
    everyone gains mmr regardless of everything").
- **The leave penalty:**
  - **When:** a penalty is armed only while the lobby is full of humans and the match has no winner yet (re-checked as
    players come and go, the state changes, a goal is scored, a team forfeits). The **first** player to leave while it's
    armed is banned from matchmaking; then it drops lobby-wide: later leavers on either team get no ban (the game's
    Abandon Match turns into Leave Match, running forfeit votes end). It re-arms when the lobby is full again.
  - **What counts:** leaving from the menu, a disconnect or timeout, an idle kick (also a map-load failure, an
    anti-cheat kick). At most one ban per player per match.
  - **Leniency:** no ban when every connected player has received nothing for 20 s or more (a server outage); one
    player's bad connection gets none. Ours as well (AP3): a leave by a lost connection is held 5 s, and no ban when most
    of the match's seats lose their connection within 5 s of it (the server's network: every session times out together).
  - **Issued at the leave** (the game's `RPC_AddQuitter`), not at the match's end; **cleared by a rejoin that fills the
    lobby again** (`RPC_RemoveQuitter`, the latch re-armed); if someone else is still missing, or the match ends first,
    it stands. So the game server reports a quitter to the API when they leave, and the removal when the lobby refills
    (notes/accounts.md §3). This replaces "the ban starts when the result arrives": in the game a rejoin doesn't go
    through the queue, so the ban doesn't stop it.
  - **The ladder, its cap and decay: ours** (not in the client; public recall unreliable). **The user's choice
    (2026-10-18), LV1's suggestion:** 5 min → 15 min → 1 h → 6 h → 24 h (the cap: every later leave 24 h), and one step
    forgiven for every 24 h without a leave.
  - **The page:** a search refused while banned shows the minutes left (max(⌈s/60⌉, 1)) and cancels; the Play menu shows
    the ban (LeavePenaltyMessage, MatchmakingBanMessage by key). **The warning before leaving (RV-715, the game's
    strings):** while a ranked lobby has the leave penalty (the server's, sent as the Match message's flag 32: every
    seat's player here, no winner yet, a pending forfeit or the clock out with the scores apart counting as one: RX32)
    and no vote is the player's to take part in (shouldDisplayAbandon), the pause menu's button is ABANDON MATCH, asking WARNING, "Abandoning
    a ranked game will temporarily ban you from matchmaking. ARE YOU SURE?" with red YES / NO, NO focused, in a popup
    over the menu with its warning icon (WarningModalPopup; our modal, RV-753); a team
    playlist's first, a 1v1's after its Forfeit Match.
- **Rejoining** (corrects MM-44/MM-45):
  - **Who:** ranked **2v2 and 3v3 only**; **no rejoin in 1v1**.
  - **The slot is held** until the match ends: no bot, no backfill; the car's demolished, the team plays short.
  - **The route is a prompt, not the queue:** RECONNECT, "It appears you accidentally left a ranked match. Would you like
    to rejoin?" (YES, focused by default, / NO; the game's strings, shipped: RV-716), shown when the menu opens or after OK
    on a connection-error modal, if the match was joined **less than 900 s ago**. The game's record (RJ1: lookup of the
    live 2026-10-06 bytecode, out/bsim/agents/RJ1/): **saved at every ranked 2v2/3v3 join's loading screen, a rejoin's
    too**, so the 900 s run from the latest join; a join of any other match (a 1v1 here) clears it; **cleared as the prompt
    is shown**, whatever the answer, so one prompt per record: a failed Yes isn't offered again, a successful rejoin
    saves a new one; also cleared by Exit to Main Menu and by the match ending while connected, not by a new search.
    Ours: the record goes when the match ends on the page that plays it (RX32, as the game's). It differs in one way: a
    search gives the held seat up at our server (RX30C), so the record goes once a search reaches the server (its hello
    sent: not one refused before, for its ticket or a ban), unless it's another account's or another tab plays that
    match (the server refuses that search: RX32). No rejoin is offered while the deployment's config can't be read (its
    Yes couldn't start; the record kept for a later visit: RX31).
    Ours keeps it per account (the signed-in account that joined: another account in the browser isn't offered it,
    RV-711). The server takes the player back only while the match runs and their slot is listed (else "Match has
    concluded.", the game's TAErrors text). A rejoin's ticket refused for a ban from another match shows the ban as a
    search does, under RECONNECT (ours, RX31). A claim's page tries its config.json and its ticket up to 3 times, a second
    apart, inside the claim's window, so a passing fault isn't a no-show; a failure goes back to the menu's modal (RX31). A rejoin skips the ban check (ours:
    a rejoin's ticket for that match, which the ban doesn't stop). A rejoin before the server has seen the old session go
    (it times out after 10 s) takes the seat over once that session has been silent 3 s (and joined at least 3 s ago, so a
    just-rejoined session not heard from yet isn't taken over at once: RX31), the old session told it was replaced (AP3)
    and no vote ended for it (the lobby stays full: RX31); a live one (another tab of the account playing it) refuses the rejoin and keeps its seat (Refused 5),
    and a tab playing the match holds a Web Lock on it, so the browser's other tabs don't offer the rejoin (RX30C).
  - **An idle kick is a leave:** the game server counts it as it happens (the quitter flag, the latch, the ban if first
    and armed), as it does a player it drops for not reading its messages; the forfeit the kick itself causes is no
    excuse (RX30C).
  - **Not after a deliberate leave:** Exit to Main Menu clears the saved match, so no prompt; a disconnect or a kick
    (an idle kick too) keeps it. A leaver may search again at once (the game's start gate refuses only a search already
    running, a ban or no connection: MM-2): the held, empty seat doesn't stop it, and the new search gives it up (no
    rejoin of it after). Only a seat with a session (two tabs or devices at once) refuses a search (Refused 5).
    A reported quitter's searches are also refused by the game server for 5 minutes (Refused 7), so a ticket fetched
    before the ban doesn't dodge it (AP3); a search already waiting when the report is made (a lost connection's leaver
    searching inside its 5 s) is refused then too, and a refill forgets the account at once, as the API lifts its ban
    (RX31).
  - **Back in:** the same team, their stats restored, spawned at once, no longer a quitter.
- The no-show search ban (2 minutes) stays as it is, now by account.
- Ratings are shown as numbers, lichess-style, with "?" while provisional (a deviation of 110 or more: scalachess's
  `provisionalDeviation`, "at least"; lichess's FAQ says "greater than"; the API's rule).
- **Built 2026-10-18 (ranked step 3):** the results and the leave penalty's latch in the game server's match host (each
  seat's first ticket; the first armed leaver reported at the leave, after 5 s for a lost connection; a refill, shown by
  the rejoin's ticket, undoes it; no contest sends nothing; no ban after a 20 s server silence or when most seats drop at
  once), the ladder and Glicko-2 in the API (notes/accounts.md §3), the rejoin (protocol 27:
  Hello's intent 3, Welcome's match id; the page's offer within 900 s, cleared by Exit to Main Menu), one search or match
  per account (Refused 5), and **ranked pairing (ours)**: each search carries its account's rating (the ticket's), the
  oldest searcher matched with those within ±100, wider by 50 every 10 s either has waited, ±600 at most, then anyone;
  the teams split by a snake draft. The game's strings (the rejoin prompt, "Match has concluded", the ban messages) are
  our words by key until the user clears them.

## Regions and multi-region search (the user's decision, 2026-10-22: Newark, Frankfurt, Singapore)

Design (ours; the game's PsyNet matchmaker is unknowable: MM-3 sends regions with pings, the rest is PsyNet's):
- **One game server per region, nothing shared between them.** Each runs its own queue and matches; a region is just
  another `carball-game` with its own `PUBLIC_HOST` and certificate (`game`, `game-eu`, `game-asia` .carball.zolt.top).
  Everything else is the same everywhere: `ALLOWED_ORIGIN` (the one page), the ticket keys, `API_URL` and the results
  token (the API's 300 calls a minute are shared by all of them). Match ids are random 64-bit, so results never clash.
- **The page's list:** `carball-web` takes `GAME_SERVERS` (`id|Name|URL`, comma-separated, in order); `config.json` carries
  them as `gameServers` and still carries `gameServer` (the first), so pages loaded before the change keep searching
  the first region. The CSP's `connect-src` names every server's origin. Without `GAME_SERVERS`, `GAME_SERVER_URL` alone is
  a one-region list (no picker shown). A development page lists `?queue=host:port,host:port`.
- **Ping:** each region measured from the page: a session opened, a hello with intent `PING` (4), the server's `Pong`
  timed (one round trip on an open connection; the better of two). A server from before the change refuses the intent:
  its refusal is timed instead. Measured when the Play page opens (again after a minute).
- **The picker (Play page):** the game's word **Regions** ([Global] Regions) over a checkbox per region, its name and ping;
  at least one stays ticked. The first visit ticks the lowest-ping region, kept once the pings are in; the player's choice
  is kept in local storage. A search with nothing kept (the page's own: Play Again, the way back from a cancelled match)
  waits for the pings, 3 s at most, then takes the lowest so far, else the first (RX43C-1). Shown only
  with two or more regions. One region ticked while more exist: the log's **MoreRegions** tip at 30 s (cleared verbatim).
- **Multi-region search:** Find Match opens one search per ticked region in parallel, all with one search ticket (its
  nonce kept per server, so each server takes it once: a search costs one ticket, the claim's never squeezed out,
  RX43C-2; the API's limit 60 per 10 minutes). The panel says Searching once any region
  searches; a region that fails while another searches is dropped (a warning line); the search fails only when every
  region has. **The first match found wins:** the other regions' searches are finished (their stream closed: the server
  takes them out of its queue, then writes out anything it had sent), so a region that wasn't matched just ends (no
  no-show: no match, no penalty).
- **The race** (another region matched in the same moment: its `MatchFound` arrives during that finish): that slot is
  given up with a hello of intent `DECLINE` (5) and its token, ticketed like a claim. Its server cancels that match at once
  (its other players back to the front of its queue, as for any cancelled match) and **doesn't count it a no-show, once
  per 10 minutes per account**; a second decline on that server within 10 minutes counts as a stall (its cooldown). It
  can't dodge a match: a decline comes before the claim, when nothing about the match (its players) is known; the most it
  could do is cancel someone's match now and then, which the once-per-10-minutes limit bounds, and they're first in line
  again. A Cancel Search during "Joining in" stays a claim and leave, a stall (unchanged).
- **The match's server is remembered:** the claim (the match page connects to that region), the saved seat (the rejoin
  offer connects there; an older record without one is the first region's) and a cancelled match's returning token (its
  search goes back to the front of that region's queue only).
- **Protocol:** intents 4 and 5 and the `Pong` control are additions, not a version change: pages already loaded never send
  them, and servers from before refuse them harmlessly (deploy the servers first).

## v1 queue checklist (user scope 2026-10-14: ship v1; simple queue, no rating or ranks)
Only what the v1 queue needs, distilled from the rows below. **V** = cleared to ship verbatim (user decisions); **K** =
by key / our own wording. Dropped for v1: ranks/MMR, backfill and join-in-progress, bots, parties, regions, leave
penalty, the queue-time estimate, reconnect prompts.

**Search**
- [ ] Play → pick a playlist: **1v1 / 2v2 / 3v3** (single select is enough; multi-select optional) → **Find Match** (V).
- [ ] While searching: the main-menu panel (MM-4) with the summary **Searching** (V) (+ Connecting / Joining / Failed, V),
  the decorative radius bar (8.82 s per step, 17 steps; optional), the log line **FindingBestMatch** then
  **WaitingForMorePlayers** at 150 s (V; no skill lines), and **Cancel Search** (V; pad Y / button).
- [ ] Elsewhere (free play, menus): the 26 px top banner with the summary and Cancel Search; the in-match HUD shifts down
  26 px only while searching (HUD-2a). No elapsed-time counter (the game has none).
- [ ] Searching from free play is allowed; cancel plays a cancel sound, start plays a start sound (our own sounds).
- [ ] Auto-cancel when the connection to the queue drops; show the summary **Failed** (V) and a warning line.

**Match found**
- [ ] No accept step. **"Joining in {n}"** (V) for 3, 2, 1 with a beep each (our sound), then load/travel.
- [ ] **Start only when full** (user decision): every slot filled, every player loaded; then the normal intro and kickoff.
  If a reserved player never loads within the reservation timeout (game: 30 s initial / 15 s wait; ours to choose),
  cancel the match and put the others back in the queue with a warning line (MM-18 style).
- [ ] No backfill: a leaver's slot stays empty; forfeit votes as now (MR-7).

**In the match**
- [ ] No team switching or spectating (MM-29): the server refuses team-change requests.
- [ ] **Idle kick** (cheap, server only, MM-32..38 + MM-35a): during Active play only, a 1 s check; warning at > 25 s idle,
  kick at > 30 s; idle carries over between rounds; activity = the MM-35a input predicate on each consumed frame (button
  flips; throttle / pitch-stick |Δ| ≥ 0.01; steer / yaw only while throttling), quick chat, replay skip. The warning tip
  **Warning** + "you will be kicked for being idle" (V), no countdown digits; the kick sends a reason, closes 1 s later, and
  the client shows the idle-kick modal (V). No ban.

**Match end**
- [ ] Podium and end screen as now (MIO). Like the game's ranked flow (no rematch vote, MIO-29/32): **Play again**
  (re-search the last playlist; V as end-menu text) and **Exit to Main Menu** (V, with its confirmation), plus the
  "Leaving in {n}" countdown (V, next-match texts cleared) → back to the menu at 0. (A "Change playlist" button is
  optional.)

**Disconnects**
- [ ] Lost connection → back to the menu with the **connection lost** modal (V; title `DefaultDisconnectionTitle`, OK).
  The slot is not held (no reconnect prompt, MM-44/45). "(Error: NN)" strings: K.
- [ ] Server-ended matches show a reason (MatchKick etc., K).

**Server must enforce** (from "Server must enforce" below, trimmed): per-playlist queues; ignore stale or duplicate
searches; re-queue after a failed join; full-only start; refuse team change / spectate; the idle kick; free a leaver's
slot at once (no backfill); send reasons for server-ended matches.

**User decisions, REVISED (2026-10-14, via tmp-3b; supersede the casual start/backfill choices below):**
- **Ranked-style matchmaking:** matches start **only when full**; **no backfill or join-in-progress**; a leaver's slot
  stays empty (forfeit votes as now); **no bots**; **no leave penalty** for now.
- **Skill rating with visible ranks:** an MMR per playlist (1v1, 2v2, 3v3) pairs players, and ranks are shown. Identity
  is the browser's stored key (no accounts).
- **Order:** the queue comes after netcode and hosting. A client-side ranked spec (where ranks show, tier/division
  structure, rank-up/down and placement screens) is queued for the static session after the current netcode job.
- Still valid from the earlier decisions: the verbatim text groups below. The earlier "start nearly full + backfill" and
  "backfill limits" (lead ≥ 3 goals / < 1:00) are **superseded**. Rank names, division text etc. are by key until the user
  clears them per case; rank icons are art (described only).

**Ratings: idle kicks and leavers (user decision, 2026-10-16, via tmp-42; items 1 and 2 superseded by 2026-10-18's
leavers rule above; item 3, the no contest, stands):**
1. A player idle-kicked or leaving while the other side is still active takes a **loss**, as if they had lost the match
   (the game's abandonment treatment).
2. The team left standing **gains rating only if it is still active**: someone on it gave input within a recent window
   (e.g. 10–20 s, to be tuned).
3. If **no one is still active** (both sides kicked together, both idle, or kicked on the same tick), the match is a
   **no contest**: "it doesn't count as a win or a loss. it's as if the game never happened" (the user, corrected
   2026-10-16): **nobody's rating changes**, no gain for anyone and no loss for the kicked players.
- **Caveat:** identity is only the browser's stored key, so dodging a rating by starting over with a new key (or farming
  with fresh keys) needs accounts or some identity that is harder to reset before ranks matter.

**Earlier user decisions (2026-10-14, via tmp-3b):**
- **Verbatim text cleared** for four groups:
  1. the search UI words: Searching…, Cancel Search, Connecting / Searching / Joining / Failed, "Joining in {n}",
     Find Match, Single / Multiple Selection;
  2. the idle WARNING, "you will be kicked for being idle" and the idle-kick modal;
  3. the "connection lost" modal;
  4. the search-log lines that match what our matchmaker does: FindingBestMatch and WaitingForMorePlayers, plus
     MoreRegions / MorePlaylists only if we search more regions / playlists. **Not** the skill lines.
  Error strings with "(Error: NN)" codes are not in the list (by key / own wording).
- **Start rule:** the game's way: start **nearly full** (N − ⌊N/3⌋: 1v1 2/2, 2v2 3/4, 3v3 4/6), then backfill the open
  slots and leavers' slots.
- **Backfill limits:** no backfill when a team leads by **3 or more goals** (MaxScoreDiff = 2) or when **less than 1:00**
  is left (MinSecRemaining = 60). As in the game, the clock isn't reported in overtime, so overtime blocks backfill
  (MM-19); the post-game lobby always allows it.

**Text rule:** apart from the cleared groups above, game text below is **by key only**. The English gloss is local (`out/bsim/agents/MM1/text_gloss.txt`).
Nothing ships verbatim until the user clears it; the candidates are listed at the end.

**Citations.**
- Script: TA = `out/bsim/work/tagame_live_all.txt`, PX = `out/bsim/agents/PNT1/projectx_live_all.txt`,
  ENG = `out/bsim/agents/K1/work/live_engine_ubc.txt`.
- AS3 in `out/bsim/agents/HUD1/dec_as3/`: PM4 = GFX_PlayMenuV4, SHL = GFX_UIShell, HMI = GFX_HudMatchInfo, HUD = GFX_Hud.
- Movie dumps: SHL.chars, HUD.chars/tree, shared.chars/anim (`HUD1/dump/`).
- [A] = `scripts/props.py` on the live decrypted packages (dumps in `out/bsim/agents/MM1/props_*.txt`).

**Tags.** [S] script; [G] AS3; [M] movie layout; [A] package defaults; [N] native (not decompiled); [I] inference;
**[PsyNet]** = Psyonix backend or playlist data delivered at run time.

## 0. Three layers
1. **PsyNet matchmaker [PsyNet]:** who is matched with whom, skill, regions, the estimated queue time, playlist flags,
   backfill thresholds.
2. **Dedicated-server game logic** (in the exe's script, so knowable): reservations, the shape of the backfill policy,
   team picking, bots, the idle kick, the wait for players. It runs on Psyonix's servers; for us it is "server-side but
   specified".
3. **Client UI:** the search UI, messages, warnings, modals.

## 1. Search (MM-1 … MM-12)

| ID | Rule | Evidence | Conf |
|---|---|---|---|
| MM-1 | **Start.** Play → a playlist folder (casual tiles; the menu tree is PsyNet `MenuTreeConfig_TA`) → **Single Selection** or **Multiple Selection**:<br>• The mode toggles with pad Y or the legend, if the folder has `bCanUseMultiSelect`, you are not searching, and you are solo or party leader.<br>• **Single:** a playlist's FIND MATCH deselects everything else, selects it and starts.<br>• **Multiple:** each tile's SELECT toggles it; FIND MATCH (pad A) searches all checked playlists of the folder.<br>• Saved per profile (`QuickMatchPlaylists`, `bUsingMultiselect`, `LastMatchmakePlaylistID`).<br>• REGIONS and ARENAS buttons when `bShowArenasAndRegions`. | PM4:72288-72899, 67748-67784; TA:47228, 46798, 67296 | [G][S]; tile-click path [I] |
| MM-2 | **Start gate (client).** StartMatchmaking returns false when: already searching (`[Matchmaking] SearchInProgress`); banned (`LeavePenaltyMessage`); an online-status error; no playlist (`NoPlaylistSelectedMessage`); the party is bigger than the team size. Each playlist needs PlayerCount ≥ 2 × party size. A privilege / anti-cheat check runs first. | TA:46851, PX:11203, PM4:72881 | [S] |
| MM-3 | **Search request** `RPC_StartMatchmaking`: playlists, regions with pings, **SecondsSearching**, current server ID, cross-play flag, ignore-skill flag, party members. The answer may carry BannedSecondsRemaining and **EstimatedQueueTime**. Everything after is PsyNet. | PX:11194, 11407 | [S]; matching [PsyNet] |
| MM-4 | **Searching panel (main menu)** (`SearchingPlayMenu`, over the screen):<br>• title: the folder's title, else `[Global] SearchingTitle`; centred, y = (H − h)/2 − 50;<br>• the summary animation (MM-6), the search-radius bar (MM-7), a message log (MM-8: $NormalFont 12, #43AFFF α 0.71, 800 × 44, centred), the queue-time line (MM-9);<br>• a **CANCEL SEARCH** button (pad Y);<br>• **WHILE YOU WAIT** cards: Free Play / Training / Challenges (`Features.QueueMenuChanges`), else Training / Item Shop / Garage.<br>• Back closes the panel; the search continues and the banner (MM-5) shows. It closes itself when the search ends.<br>**Which view (MS1, 2026-10-16):** every Find Match handler calls MenuTree.StartMatchmaking(); if bSearching, **UIState MAIN_MENU → openMenu(SEARCHING_PLAY) (the panel); otherwise MenuManager.exitTree() (the Play menu closes) → the banner only** (SHL m#8577, 45110-45119; PM4 m#10838/10839, m#10410/10411, m#10394, m#10324/10326). No feature flag decides it: Features.QueueMenuChanges only picks the WHILE YOU WAIT cards (PM4 m#10895); the compact flag only picks the banner class. The panel opens only at search start (re-entering Play during the search shows the banner), focuses its first card, closes on B (search continues), a card, or the search's end; its own Y release cancels (m#10484). | PM4:73326-73590, 55289-55730; SHL.chars #448 | [G][M] |
| MM-5 | **Banner while searching (everywhere else).** Compact view (`DEBUG_USE_COMPACT_MATCHMAKING_VIEW = true`, SHL:86897):<br>• a full-width strip at the top, **26 px tall** (`searching_ticker_bg` 200 × 40 × 0.649), extended up into the safe zone;<br>• created when `bSearching` turns true (not for tournaments), removed when the search ends; hidden (slides to y −35 and fades, 0.2 s) while the searching panel is open;<br>• contents: the summary (MM-6) centred; CANCEL SEARCH at the left (PC button; on a pad "‹Y› CANCEL SEARCH" $HeaderFont 15, only in the main / pause / end-game / Play menus and the winner screen); the queue time at the right ($NormalFont 15, #43AFFF, right-aligned).<br>• **In-match HUD:** the scoreboard moves down `MATCHMAKING_VIEW_HEIGHT` 26 while `bSearching` (no split screen), under this strip (HMI:49857, 50077; HUD-2a).<br>**Spec (MS1, 2026-10-16; 720-unit stage, W = 720 × aspect, banner anchored top-right, scales with ContentScale = screenH/720 × UIScale × SafeZone):** **created and removed instantly** when bSearching turns true/false (SHL m#12572), only the y −35 / autoAlpha 0.2 s slide around the main-menu panel (m#12559/12560); full screen width, screen top to **y 26**, extended into the safe zone, blocks clicks; background `searching_ticker_bg` = opaque **#00101D** with a **2-unit #41AEFF light line at y 24–26** (alpha peaking 0.67 at ~0.48 W, half strength 0.26–0.69 W, gone by ~0.11 W and ~0.85 W). **Centre:** the summary (MM-6) at y 14, scale ~0.903: $HeaderFont 16 (≈ 15.7 units), white, skewed ~6.8°, then three pulsing pills (#41ABFF, each 1.4× + white flash for 0.2 s, 0.4 s apart, 1.233 s loop) with an additive #016BF7 radial glow (peak α 0.73); group centred +6 units. **Left (only where pad-Y cancel applies, MM-10):** pad mode "‹Y› CANCEL SEARCH" $HeaderFont 15 white from x ≈ 6.5, glyph 1.5 × line height (≈ 26 units), fade in 0.2 s / out 0.3 s; PC mode a slanted CANCEL SEARCH button (x ≈ 38–160, y 3–19, ~9°, #204C73 → #296D9E, $HeaderFont 14), fade 0.2 s; neither while driving in free play. **Right:** queue time ($NormalFont 15 #43AFFF, value white, right edge W − 6), polled from 5 s, empty at 0. No playlist name, no message log, no timer, no radius bar. | SHL:76305-76600, 87809-87850, 87926; SHL.chars #439 | [G][M] |
| MM-6 | **Summary label:** CONNECTING / SEARCHING / RECONNECTING / JOINING / FAILED from `OnlineMatchStatus.SearchState`, each with a clip (searching: blue chevrons; reconnecting: yellow chevrons; joining: spinner + glow; failed: alert icon). $HeaderFont 16, white + additive (1, 107, 247); slides −10 → −20 → −10 px over 0.37 s; fades out 0.3 s when the search ends. PingRegions and Searching → "Searching", Joining → "Joining", an error → "Failed".<br>**Correction (MS1):** the searching clip is **three pulsing pills** (#41ABFF), not chevrons; the text is skewed ~6.8° and stays white (the additive tint doesn't change white); glow additive #016BF7; RECONNECTING amber pills (#FFCD41) + amber glow (255, 141, 1); JOINING a cyan three-arc spinner (~26 units, pops from 1.87×) + an additive #43AFFF streak ~230 units to the left; FAILED a red triangle (~26 × 24) + #FF4343 glow. Each state change replays a 0.37 s intro (text jumps 4.5–9 units left and eases back over 0.3 s; icon pops from 2.73× with a white flash; glow fades in). | HMI:57142-57230; shared.anim #724; PX:11093-11160; TA:49885 | [G][M][S] |
| MM-7 | **Search-radius bar** (decorative, client timer): one step every **8.82 s** (width 16 + 14·n px), up to **17 steps**; tint ≥ 7 yellow, ≥ 10 yellow-orange, ≥ 13 orange, ≥ 17 red (≈ 62, 88, 115, 150 s). Paused while RECONNECTING, stopped at JOINING, reset at CONNECTING. Not tied to server data. | PM4:55298, 55328, 55515-55615; HMI:58341-58540 | [G] |
| MM-8 | **Message log** (client timeline, only while "Searching"): 5 s FindingBestMatch; 10 s MatchmakingTime; 15 s MatchmakingTime2; 30 s AllRegions (more than one region) else MoreRegions; 45 s SkillUpdate1; 60 s MorePlaylists and 90 s SkillUpdate2 if not every playlist is selected, else 60 s SkillUpdate2 and 90 s SkillUpdate3; 120 s SkillRangeMaxed (ranked) or AllSkills; 150 s WaitingForMorePlayers.<br>Status lines from the backend flow: PingingRegionsString, SearchingString, FoundServerString, SendingReservationMessage, WaitingForPlayersString, errors.<br>Colours: status #43AFFF, warning #FF4343, error #FFE445, countdown #FFFF00 (case mapping from a decompiled switch [I]). Overflow drops the oldest line; two lines are kept for re-display. "Hide Matchmaking Status" shows only FindingBestMatch. | TA:46895-46931, 49906; PM4:55619-55660, 14569-14580; PX:11096-11120 | [S][G] |
| MM-9 | **No elapsed-time counter anywhere.** The only clock-like items are MM-7 and the **queue time**, polled every 5 s until non-zero: > 0 → "`EstimatedQueueTime` ‹time›" (shorthand units, "1m 45s" style [I]); −1 → `LongMatchTime`; 0 → empty. From PsyNet; hidden when "Max Matchmaking Delay" > 0. | SHL:56294-56360; TA:46691 | [G][S]; value [PsyNet] |
| MM-10 | **Cancel** (CANCEL SEARCH or pad Y; solo or party leader): stop the message timer; `bSearching` false; end the join countdown; PsyNet `RPC_PlayerCancelMatchmaking` unless a join is under way; SharedSounds `CANCEL`. During the join countdown: JoinGame.CancelJoin (to the reservation beacon, `bAllowPlayerCancelMatch`; party members get `AnotherPlayerCanceled`). After the loading screen started: console `Disconnect`.<br>**Pad Y routing (MS1):** the banner's InputDelegate (priority 4000; modals 5000, the panel 0, menus −100) cancels on **Y release** (no hold; presses and repeats ignored), consumes the event, plays CANCEL, hides the queue time; ignored when already handled, a modal is open (Settings is a modal screen, so Settings' Y Clear Keybinding wins), or the banner is hidden (the panel is up, with its own Y). Allowed only when solo/leader, searching, the friends list closed, and a main-menu page, the pause or end-game menu, the Play menu or the winner screen is up (m#11484) — never while driving (Y stays ball cam). Multi-select's Y is off while searching (PM4:72420). | TA:46934; PX:11060, 11341, 10563-10580, 10792; SHL:76560 | [S][G] |
| MM-11 | **Auto-cancels:** internet link lost (`MatchmakingNoInternet`); party size or leader change; a time-limited playlist ends; **an online game starts on this client**. Offline Free Play / Training does **not** cancel (search from free play is allowed). | PX:11143, 11226, 11530-11545; TA:46645 | [S] |
| MM-12 | **Sounds:** SharedSounds `START_MATCH_SEARCH` when `bSearching` turns true; `CANCEL`; `COUNTDOWN3/2/1` during "Joining in" (MM-14). Wwise events not traced (O-4).<br>(MS1) START_MATCH_SEARCH plays once per search when the banner is added (even hidden; m#10542); COUNTDOWN3/2/1 come from the banner (m#10555); the "Joining in N" lines appear only in the panel's log. No popup or modal at search start. | HMI:54233, 54426; SHL:5027-5062 | [G]; mapping [I] |

## 2. Match found (MM-13 … MM-18)

| ID | Rule | Evidence | Conf |
|---|---|---|---|
| MM-13 | **No accept step** in casual. A PsyNet reservation goes straight to the join: a reservation from a previous search or an unselected region is ignored (re-search 1 s later); the same server you are on = search complete; else ReservingServer: ping every 3 s, send the reservation, wait for Ready. Full / match ended / timed out / setup failed → the join fails with that string, back to PingRegions with a warning line. | PX:11423-11470, 10580-10740 | [S] |
| MM-14 | **The notification is "Joining in N."** `JoinCountdownTime` **3**: the log shows `[Matchmaking] JoiningIn` (yellow) at 3, 2, 1; COUNTDOWN3/2/1 sounds; OS window flash (`FlashWindow`); a `GameFoundFF` rumble (no rumble in the clone); summary JOINING. No separate "match found" sound or popup. | PX:10741-10758; PM4:55716; HMI:54400-54440; [A] Archetypes.Online.OnlineGame.JoinGame | [S][G][A] |
| MM-15 | **Transition:** at 3 s `open JoinGameTransition?game=TAGame.GameInfo_Transition_TA` (loading screen), travel, wait until every local player has a controller → join complete. Failure: `disconnect`, back to the menu with the reason. | PX:10788-10825; [A] JoinGame LoadingScreenCommand/FailCommand | [S][A] |
| MM-16 | **Landing in a fresh match.** The dedicated server loads the map once reservations are *full enough* (casual: **nearly full** = N − ⌊N/3⌋, i.e. 1v1 2/2, 2v2 3/4, 3v3 4/6; ranked: full). The client sees WaitingForPlayers, the waiting list, the side camera (MIO-1, MIO-6, CAM-30), a 3 s warm-up and the 4 s countdown. Start rule: every reserved player in game with a car, and every team has a human; after **30 s** without a human on each team → no contest. A match started nearly full gets **bots at the first countdown** (`Countdown.BeginState` → `TimerUpdateBotCount`; none while WaitingForPlayers); backfill humans replace them (MM-19). | PX:12765-12822; TA:67797-67830, 3662, 3948; [A] WaitForPlayersTime 30 | [S][A]; casual bot flag [PsyNet] (MM-25) |
| MM-17 | **Landing in a match in progress** looks the same to the client up to the load. | PX:12242 | [S][I] |
| MM-18 | **Failures the client sees:** reservation full / expired, `NotAllPlayersJoined`, `MatchEnded`, beacon timeout. Each is a warning line and an automatic **re-search**; the search ends only on cancel or a hard error. Reserved players who don't load in time (ExtraMapLoadTime 5 s + platform load time [N]) lose their slot on the server. | PX:10674-10740, 11460-11467, 12603, 12924-12946 | [S] |

## 3. Join in progress, backfill and bots (MM-19 … MM-28)

| ID | Rule | Evidence | Conf |
|---|---|---|---|
| MM-19 | **No `bAllowJoinInProgress` / `JoinInProgress` in the live build.** Backfill = `BackFillPolicy_TA` on the playlist. Soccar policy: request backfill when **not a bot match** and (**post-game lobby** or (\|score0 − score1\| ≤ **MaxScoreDiff** and clock seconds remaining ≥ **MinSecRemaining**)). Amount per team = NumPublicConnections / 2 − reservations on that team (≥ 0). Reported to PsyNet with UpdateGameServer (team sizes, scores, `TimeRemaining`, post-game flag, `BackfillTeam1/2`) every 30 clock seconds while not full (`SecondsRemaining % 30 == 0`), on each new round and in the post-game lobby. The clock is reported only outside overtime and as 0 at the end, so overtime and the last seconds block backfill unless MinSecRemaining ≤ that. | TA:10820-10852, 37774-37781, 3229, 2827; PX:9862-9890, 9957-9966 | [S]; MaxScoreDiff, MinSecRemaining, PolicyType [PsyNet] (`Default__BackFillPolicy_TA` empty) |
| MM-20 | `bNoBackFill` (playlist flag) hides "join party member's match". PsyNet decides who backfills; the reservation brings PsyNet's team lists. | TA:50104; PX:12242-12256 | [S]; [PsyNet] |
| MM-21 | **Joiner's team (server):** public match type → `PickTeamFromReservations` (the reservation's team; invalid → native `AssignTeams`). Fallback `MatchType_TA.PickTeam`: **fewer humans** → **fewer members** → **lower score** → **random**. | TA:2157-2165, 67520-67575, 67829-67838; PX:12693 | [S]; AssignTeams [N] |
| MM-22 | **What a joiner sees (Active):** the side camera (CAM-30) until its car exists. If its team has a bot: attached to it (`SetBotReplacement`); the view **follows the bot's car** with its own camera settings; the HUD hides the boost meter and ball-cam indicator and counts **3, 2, 1, GO** (`ReplacingBotCountdownMessages`, 3 s ticket, MR-7.13); then it takes the bot's location, rotation and velocity and the bot is removed. No bot: it spawns at once at a random respawn spot (MR-7.12). Score, clock, scoreboard and replays are replicated, so it sees the live state at once. | TA:1092-1160, 2225-2240, 76672-76690, 61786-61795, 14820; HUD:71435, 71462 | [S][G] |
| MM-23 | **Join in other phases:** Countdown → no bot takeover (`Countdown.FindBotReplacement` empty), a kickoff spot, a surplus bot destroyed by UpdateBotCount. PostGoalScored or replay → no spawn until the kickoff; it watches the streamed replay and must press skip (MRL-6). WaitingForPlayers → the normal start (MM-16). | TA:1856, 2255-2330; MR-6.5 | [S] |
| MM-24 | **Rejoin by the same ID** (e.g. a backfill puts a leaver back): the old PRI returns from `RemovedPRIs` with its stats (`CheckJoinInProgress`), appended to `Players` (MRL-8); the forfeit-initiator lockout survives (MR-7.5). | TA:3374-3390, 4636 | [S] (CheckJoinInProgress body: decode error) |
| MM-25 | **Bots in casual are supported by the script:** `bFillWithAI = Playlist.bAllowBotFills`, forced false for ranked; bot takeover and `ReplacePlayer` only for `!bRanked`. Casual's actual flag is PsyNet data, inferred **true** (consistent with MRL-14). Bots never spawn while waiting for players. (The clone has no bots: user decision.) | PX:6725; TA:901-930, 1114-1125, 3662 | [S]; value [PsyNet]→[I] |
| MM-26 | **The HUD lists reserved and joining players** (`GRI.Reservations[8]`: ID, name, status Reserved / Joining / Joined); rows marked disconnected until Joined. Feeds the waiting list (MIO-6). The in-match scoreboard shows only players on a team (SB-8). | TA:61233-61246, 51378-51395; PX:7492-7511 | [S] |
| MM-27 | **End of match (casual):** the server keeps the remaining reservations; a post-game lobby forms with backfill always allowed; when full enough again → the next match with the same players; otherwise teams re-assigned by party size and backfill fills; a failed rematch vote scrambles the teams. Client side: MIO-31 / MIO-32. | PX:9356-9380; TA:72042-72070, 2338-2345 | [S] |
| MM-28 | **Server shutdown or migration:** with ≤ 30 s of clock left and a queued shutdown, the server goes "not joinable"; details [PsyNet]. | PX:9620-9640 | [S] |

## 4. Teams and parties (MM-29 … MM-31)

| ID | Rule | Evidence | Conf |
|---|---|---|---|
| MM-29 | **No team switching in casual.** `MatchType_Public_TA.ShouldAutoSelectTeam` true; `PRI_TA.ServerChangeTeam` then **reports the player as a cheater** ("Illegal team change") and replies `ClientChangeTeamFailed`; base `ChooseTeam` has no body (false). Rate limit one request per 0.1 s. Spectating is refused the same way. | TA:80798-80830, 67862, 67637, 2315 | [S] |
| MM-30 | **Team display:** your own team is always on the left (HUD-2). | hud-menus HUD-2 | – |
| MM-31 | **Parties:** only the leader searches or cancels; size or leader changes cancel (MM-11); "Party Up" on the end screen (`CanStayAsParty`). **Guests: solo only; hide all party UI.** | PM4:72420; TA:67847; MIO-29 | [S][G] |

## 5. Inactivity kick (MM-32 … MM-40)

| ID | Rule | Evidence | Conf |
|---|---|---|---|
| MM-32 | **Per match type, server only** (`Condition IsNetServer`): Public (casual), ranked, honor duel → **IdleKick**; auto-tournament → **IdleBan**; private, ad-hoc, online freeplay → **IdleTrack** (statistics only). | [A] Default__MatchType_*_TA.DefaultIdle* | [A] |
| MM-33 | **Timings (IdleKick):** `IdleActionTime` **30 s**, `IdleWarningTime` **5 s** (IdleFeature defaults, not config properties, fixed in the package). **Warning** at idle > 25 s, **kick** at idle > 30 s; a looping **1 s** check. | [A] IdleFeature_TA; TA:63962-63998 | [A][S] |
| MM-34 | **Only Active time counts:** the timer exists only while `ActiveGameState_TA` is present (Active; not Countdown, PostGoalScored, replay, Waiting). Idle = now − LastActiveTime if the player acted in this Active period, else (now − Active start) + idle carried over from earlier periods: **idle time accumulates across rounds** until the player acts. Spectators are never idle. **0:00 counts as Active:** when the clock runs out, `Active.UpdateGameTime` calls `Active.WaitForEndRound` (time 0, attach EndRoundComponent) with no state change; the round ends only when the ball touches the ground (or is already asleep, or the overtime BallHitGroundTimeoutSeconds fires): `EndRoundComponent_TA.HandleBallHitGround` → `EndRound` → `StartNewRound` → EndGame, or StartOvertime + StartCountDown. So the idle timer keeps running through the 0:00 wait. | TA:63962-64020, 4199-4221, 27096-27140, 3015-3030; MM1 idle_param_classes.txt | [S][A]; system binding [I] |
| MM-35 | **Activity** (`PlayerController.LastActiveTime`): **vehicle input changes** (native `_Types_TA.VehicleInputHasChangedForKick`, live 0x140e70540, predicate not decompiled, O-1); **quick chat** (`ServerSay_TA` with bPreset); **text chat**; **ready-up / replay skip** (`ServerReadyUp`); controller creation. The pause menu updates only the client's copy (ignored). | TA:77293-77300, 95304-95312, 80711-80714, 61611-61614; ENG:9438 | [S]; input rule [N] |
| MM-36 | **Warning UI:** the HUD tip panel (TipView, anchor (850, 500) on the 1120 × 720 stage) with `[Global] Warning` (upper-cased) and `[Global] YouWillBeIdleKicked`: red feathered panel (+(50, 5, 0), α 0.8), header $HeaderFont 36 white with red glow #C83231, body $NormalFont 16, slides in from +20 px with a white flash (0.3 s). Only while ACTIVE with the car camera in view. **No countdown digits** (`IdleKickSeconds` 5 is set but never displayed). Hides at once on activity. Priority over the unflip tip. | HUD:56451-56630; HUD.chars #85; HUD.tree d86; TA:64040-64046 | [G][M][S] |
| MM-37 | **The kick:** metrics, then `PC.IdleKick()` → `CloseConnectionWithReason('OnlineErrors.OnlineServerConnectionErrors.IdleKick')`: the reason goes to the client and the connection closes **1.0 s** later (`CloseConnectionDelay`). | TA:64036-64039, 77147; PX:21078-21085; [A] PlayerController_X | [S][A] |
| MM-38 | **After the kick (client):** main menu, then the error modal (`GFxModal_Error_TA`): title `[GFxShell_TA] DefaultDisconnectionTitle`, body `[OnlineServerConnectionErrors] IdleKick`, OK. The first pending error wins. | TA:63184-63220 | [S] |
| MM-39 | **No idle penalty of its own;** removal takes the normal leave path (ban only with `bApplyQuitPenalty`, full lobby, no winner: MR-7.9; casual's flag [PsyNet]). N/A for guests. | TA:1031-1045 | [S]; [PsyNet] |
| MM-40 | **`bIdleBanned` is set only by IdleBan (auto-tournaments).** In casual and ranked it is never set, so the forfeit-vote idle exclusions (MR-7.3, MRL-9) never apply there; our server's omission is correct. | TA:64024-64033 | [S][A] |

## 6. Disconnects and reconnecting (MM-41 … MM-48)

| ID | Rule | Evidence | Conf |
|---|---|---|---|
| MM-41 | **The disconnected client:** main menu, then a modal: `DefaultDisconnectionTitle`, body the engine reason (normally `[Errors] ConnectionFailed`, TAGame's override), OK. The client timeout is UE3 NetDriver config, not in the shipped packages (O-3). | TA:63184-63220 | [S]; timeout [N] |
| MM-42 | **In-match network warnings** are the connection-quality widget (`[ConnectionQuality]` Disconnected / HighLatency / LatencyVariation / PacketLoss / ServerHealth, HUD (1010, 220)); not specified here. | HUD.tree d88 | [M] |
| MM-43 | **Server side of a leave:** the car is demolished and the player removed from the team (MR-7.9); the PRI goes to `RemovedPRIs` and stays on the scoreboard at α 0.4 (public play, SB-8); with bot fill a bot takes the slot 0.1 s later at the leaver's pose (MR-7.12); the forfeit check runs (MR-7.10). | TA:2125-2135, 67577 | [S] |
| MM-44 | **The slot is not held in casual:** a disconnected reservation is removed unless `ShouldAllowRankedReconnect` (`bRanked && PlayerCount > 2 && !bDisableRankedReconnect`): ranked 2v2 and 3v3 hold it until the match ends; **ranked 1v1 doesn't** (LV1). | PX:12742-12750, 12853-12866, 6801-6803 | [S] |
| MM-45 | **No "Reconnect?" prompt in casual** (ranked team playlists only, 2v2 and 3v3, **not 1v1**: `[GFxShell_TA] RankedReconnectTitle/Body`, within `ReconnectTimeoutSeconds` 900, PsyNet-overridable). **LV1 corrections:** the 900 s count from the **match join** (the reservation saved at the join's loading screen, **at every join, a rejoin's too, and cleared as the prompt shows: one prompt per record**, RJ1), not from the leave; Exit to Main Menu clears it (no prompt after a deliberate leave); a rejoin that fills the lobby again **clears the leaver's ban**. | TA:66388-66420, 63472-63480, 62575-62610; [A] RankedConfig_X | [S][A] |
| MM-46 | **Back into a casual match** only by searching again and being backfilled into it (PsyNet's choice); then MM-24. | – | [I]; [PsyNet] |
| MM-47 | **Server-ended match** (forfeit / no contest, or a kick on game-event destroy): `[OnlineServerConnectionErrors] MatchKick`. A join without a reservation: `NoReservation`; before the match started: `MatchNotStarted`. | TA:71744-71748; PX:12833-12840, 77150 | [S] |
| MM-48 | **Network-issue leniency:** a leave while every player has network issues gives no ban (`AllPlayersHaveNetworkIssues`). Server-side only. | TA:1031-1045 | [S] |

## Flow (client)
```
Play → Casual folder → [Single: tile → FIND MATCH] / [Multi: SELECT tiles → FIND MATCH(A)]
  → gate checks → bSearching = true (START_MATCH_SEARCH sound)
  → main menu: Searching panel (title, summary SEARCHING, radius bar 8.82 s/step, log 5…150 s,
    queue time after the first poll, CANCEL SEARCH (Y), While-you-wait cards)
    elsewhere (menus / offline free play / end screen): 26 px top banner; in-match HUD shifted down 26 px
  ├─ cancel (Y / button) → CANCEL sound → banner and panel gone
  ├─ an online game starts on this client → auto-cancel
  └─ PsyNet reservation → ReservingServer (ping 3 s) → Ready
        → JOINING + "Joining in 3/2/1" (COUNTDOWN3/2/1, window flash) → loading screen → travel
        ├─ fresh match: WaitingForPlayers (side cam, waiting list, ≤ 30 s) → warm-up 3 s → countdown 4 s → Active
        │     (short lobby: bots at the first countdown; backfill humans replace them)
        └─ in progress: side cam → [bot on team: follow its car, 3-2-1-GO, take its car]
                                   [no bot: spawn now (Active) / kickoff spot (Countdown) / next kickoff (goal, replay)]
        failure → warning line → automatic re-search
In match (Active only): idle > 25 s → WARNING tip; > 30 s → kicked (1 s later) → menu modal "IdleKick"
Disconnect → menu modal; casual slot freed; no reconnect prompt (ranked teams only)
```

## Timers
| Timer | Value | Side | Source | Conf |
|---|---|---|---|---|
| Radius bar step / max | 8.82 s / 17 steps (colours at 7/10/13/17) | client | PM4:55298, 55328 | [G] |
| Search log timeline | 5, 10, 15, 30, 45, 60, 90, 120, 150 s | client | TA:46895 | [S] |
| Queue-time poll | every 5 s until non-zero | client | SHL:56303 | [G] |
| Population refresh | 5 s while viewing matchmaking | client | TA:46754 | [S] |
| Join countdown | 3 s (a line and a beep per second) | client | [A] JoinCountdownTime | [A] |
| Reservation ping | 3 s while reserving | client | PX:10580 | [S] |
| Stale reservation / region mismatch | re-search after 1 s | client | PX:11423 | [S] |
| Matchmaking disabled after a server error | 60 s | client | [A] MatchmakingDisabledDuration | [A] |
| Wait for players | 30 s, then no contest | server | [A] MatchType_Public | [A] |
| Reservation timeouts | initial 30 s, wait 15 s, extra map load 5 s + platform time | server | [A] OnlineGameReservations_X; [N] | [A] |
| Backfill report | every 30 clock seconds while not full, each round, post-game lobby | server | PX:9957 | [S] |
| Backfill thresholds | MaxScoreDiff, MinSecRemaining | server | – | [PsyNet] |
| Bot fill after a leave / takeover ticket | 0.1 s / 3 s | server | MR-7.12/13 | [S] |
| Idle check / warning / kick | 1 s / > 25 s / > 30 s of Active time | server | [A] IdleFeature_TA | [A][S] |
| Kick → connection close | 1.0 s | server | [A] CloseConnectionDelay | [A] |
| Ranked reconnect window (not casual) | 900 s | client | [A] RankedConfig_X | [A]; PsyNet may override |
| Banner hide / show | 0.2 s | client | SHL:87834-87850 | [G] |

## Text keys (by key)
- **Play menu:** UIText `[MainMenu] FindMatch`; `[Global] MultipleSelection`, `SingleSelection`, `Select`, `Regions`,
  `Arenas`; `[Matchmaking] SearchInProgress`, `NotPartyLeaderCantSearch`, `NoPlaylist`, `TotalPlayers`,
  `PlayersInPlaylists`, `PlayersInPlaylistsPlural`; `[GFxData_Matchmaking_TA] NoPlaylistSelectedMessage`.
- **Search panel and banner:** UIText `[Global]` `SearchingTitle`, `CancelSearch`, `WhileYouWait`, `FreePlay`,
  `Training`, `Challenges`, `Connecting`, `Searching`, `Reconnecting`, `Joining`, `Failed`, `EstimatedQueueTime`,
  `LongMatchTime`; `[Matchmaking] JoiningIn`.
- **Log:** TAGame `[MatchmakingMessages]` (12 keys: FindingBestMatch … WaitingForMorePlayers); ProjectX
  `[OnlineGameMatchmakingBase_X] PingingRegionsString`; `[OnlineGameMatchmaking_X]` `SearchingString`,
  `FoundServerString`, `StartSearchFailString`; `[OnlineGameJoinGame_X]` `SendingReservationMessage`,
  `WaitingForPlayersString`, `NotAllPlayersJoinedString`, `BeaconTimedOutString`, `ReservationFullString`,
  `MatchEndedString`, `CanceledString`.
- **Idle:** UIText `[Global] Warning`, `[Global] YouWillBeIdleKicked`; OnlineErrors `[OnlineServerConnectionErrors]
  IdleKick`; TAGame `[GFxShell_TA] DefaultDisconnectionTitle`; `[Global] OK`.
- **Disconnects:** Engine `[Errors] ConnectionFailed` (TAGame override); `[OnlineServerConnectionErrors]` `MatchKick`,
  `NoReservation`, `MatchNotStarted`; `[ConnectionQuality]` keys (not specified).
- **Ranked only (not needed):** `[GFxShell_TA] RankedReconnectTitle/Body`, `[GFxModal_RankedReconnect_TA]`, TAErrors
  `[Errors] MatchHasConcluded`.
- **Candidates for verbatim use (pending the user):**
  1. banner and panel words (Searching…, Cancel Search, Connecting, Searching, Joining, Failed, Joining in {n},
     Find Match, Multiple Selection, Single Selection);
  2. the idle warning and kick texts and the connection-lost modal;
  3. the search-log lines worth keeping without a skill system (FindingBestMatch, MoreRegions / MorePlaylists,
     WaitingForMorePlayers); the skill lines would mislead;
  4. the queue-time label (only if our server sends an estimate).
  The error strings with "(Error: NN)" codes stay by key or get our own wording.
- **Exact English (decrypted Coalesced_INT, HUD1 copy line numbers; TAGame overrides win; sent to 7e 2026-10-14):**
  | Key | Text |
  |---|---|
  | UIText [MainMenu] FindMatch (26794) | Find Match |
  | UIText [Global] SearchingTitle (26560) | Searching... |
  | UIText [Global] CancelSearch (26079) | Cancel Search |
  | UIText [Global] Connecting (26135) / Searching (26559) / Joining (26305) / Failed (26242) | Connecting / Searching / Joining / Failed |
  | UIText [Global] SingleSelection (26594) / MultipleSelection (26360) | Single Selection / Multiple Selection |
  | UIText [Matchmaking] JoiningIn (26844) | Joining in {0?SecondsRemaining} |
  | TAGame [MatchmakingMessages] FindingBestMatch (21841) | Trying to find best match... |
  | TAGame [MatchmakingMessages] WaitingForMorePlayers (21852) | Waiting for more players to start matchmaking with your preferences... |
  | TAGame [MatchmakingMessages] MoreRegions (21850) / MorePlaylists (21851) | TIP: If you search in more regions you may find a match faster. / TIP: If you search for more playlists you may find a match faster. |
  | UIText [Global] Warning (26708) / YouWillBeIdleKicked (26738) | Warning (shown upper-cased) / You will be kicked for being idle. |
  | OnlineErrors [OnlineServerConnectionErrors] IdleKick (1434) | You were kicked for being idle. |
  | TAGame [GFxShell_TA] DefaultDisconnectionTitle (21510) / UIText [Global] OK (26394) | Connection Lost / OK |
  | [Errors] ConnectionFailed: TAGame Engine.int (1340) / base Engine.int (158) | Your connection to the game has been lost. (Error: 42) / Your connection to the game has been lost. |
  End-menu strings (Play Again, Exit to Main Menu + inquiry, Leaving In): match-intro-outro.md "Cleared to ship verbatim".

## Server must enforce vs client only shows (proposal)
**Server:**
1. Queues per playlist (1v1, 2v2, 3v3), several playlists per search; ignore stale or duplicate requests; re-queue by
   itself after a failed join.
2. Match start: keep the 30 s wait and the "every team has a human" rule (no contest after that, MIO-1). Either start
   when full (simplest; no bots, D-5) or the game's nearly-full start N − ⌊N/3⌋ plus backfill (uneven teams until the
   backfill arrives, MR-5 disadvantage spawns).
3. Backfill acceptance (MM-19): \|score difference\| ≤ D and clock ≥ T (outside overtime), or the post-game lobby; D and
   T are ours (server options).
4. Joiner's team: the open slot; otherwise fewest humans → fewest members → lowest score → random (MM-21).
5. Refuse team changes and spectating in casual; log them (MM-29).
6. Idle kick: only in Active; 1 s check; warn > 25 s, kick > 30 s; idle carries over between rounds; activity = the
   MM-35a input predicate on each consumed frame (not the starved-buffer zero input), quick chat, text chat, replay-skip ready-up; spectators exempt; close with reason
   "idle" 1 s after telling the client; no ban.
7. Leaves: free the slot at once (no hold in casual); keep the leaver's row at α 0.4; restore stats if the same key
   returns through backfill; keep the existing reconnect key and forfeit lockout.
8. Server-ended matches send a reason the client can show (MatchKick and friends).

**Client:**
1. Search panel and banner: summary, radius bar, log timeline, cancel on Y or the button, START / CANCEL sounds; queue
   time only with a server estimate.
2. The 26 px HUD shift while searching (HUD-2a).
3. "Joining in 3/2/1" with the countdown beeps; optional tab or title flash for FlashWindow; no rumble.
4. The bot-takeover view only if bots ever exist.
5. The idle WARNING tip (no digits) when the server flags it.
6. The menu modals for the idle kick and a lost connection.
7. No team-change or spectate controls in casual; no party UI for guests; no reconnect prompt.
8. Our QUIC idle timeout (10 s, `server/src/net.rs:49`) stands in for RL's unknown client timeout (O-3).

## Open
- ~~O-1~~ **settled** (MM2): see "MM-35a Idle activity predicate" below.
- **O-2:** PsyNet playlist data: casual `bAllowBotFills` (inferred true), `bApplyQuitPenalty`, `BackFillPolicy` values
  (MaxScoreDiff, MinSecRemaining, PolicyType), `bNoBackFill`. Live observation only; for us a design choice.
- **O-3:** UE3 NetDriver ConnectionTimeout / InitialConnectTimeout: not in the shipped packages.
- **O-4:** The Wwise events behind SharedSounds `START_MATCH_SEARCH`, `CANCEL`, `COUNTDOWN3/2/1` (probably
  Play_SFX_UI_Countdown_03/02/01 [I]).
- **O-5:** Native `AssignTeams` / `AssignScrambledTeams` (party-aware): not needed for guests.
- **O-6:** The ECS binding of the idle systems and the `IdleWarning_TA` replication path: inferred, not traced.
- **O-7:** `CheckJoinInProgress`, `PlayerLoggedOut`, `Reservations.AllPlayersInGame` and parts of `ShouldStartMatch`
  hit decoder errors; behaviour taken from the surrounding code and MR-7.14.

## MM-35a Idle activity predicate (MM2, 2026-10-14) [N]
`_Types_TA.VehicleInputHasChangedForKick`: the exec stub 0x140e70540 calls the predicate **0x140f66fc0**
(NewInput, OldInput). Decompiles in `out/bsim/agents/MM2/runs/b1..b4`.
```
EPS = 0.01f                                              // 0x141a550b8
if ((New.bits ^ Old.bits) & 0x6B) return true            // +0x1c bits 0,1,3,5,6: Handbrake, Jump, HoldingBoost, Grab, ButtonMash/AirRoll
if ((New.w20 ^ Old.w20) & 1)      return true            // +0x20 bit 0: AirRoll/ButtonMash (names of these two bits [I])
if (!(|Old.Throttle     - New.Throttle|     < EPS)) return true
if (!(|Old.DodgeForward - New.DodgeForward| < EPS)) return true   // the pitch stick (−Pitch, raw)
if (|New.Throttle| < EPS) return false                   // at zero throttle, steer and yaw are ignored
if (!(|Old.Steer      - New.Steer|      < EPS)) return true
if (!(|Old.DodgeRight - New.DodgeRight| < EPS)) return true       // the yaw stick (raw)
return false                                             // a NaN difference counts as changed (COMISS/SETA)
```
- **Never compared:** the Pitch, Yaw and Roll axes (+0x08…+0x10), bActivateBoost (derived from boost held and boost
  left) and bJumped.
- **Reference = `PC.LastInputs`** (PlayerController_TA+0xb80), overwritten only when the predicate fires. So a slow drift
  adds up and eventually counts. A **constant input counts once** (when first reached), then the player is idle.
- **On change:** `PC.LastActiveTime (+0x54c) = WorldInfo.TimeSeconds` and `LastInputs = frame`.
- **Where it runs:**
  - server, per **dequeued input frame**: tick dispatcher 0x140f214e0 → ServerConsume 0x140f23c10 → Consume 0x140ebb410
    → 0x140f607b0 (0–2 checks per tick);
  - local PCs: 0x140f215f0, once per non-resim tick, on the jump-latched copy.
  - These are the only native writers of +0x54c in the TAGame range.
- **Starved buffer:** after > 1.0 s without frames, 0x140eb7660 feeds a zeroed input straight to Car.SetVehicleInput
  and does **not** touch LastInputs or LastActiveTime, so a lagging or stalled client builds up idle time.
- **On the server** the frame holds the wire bytes converted back, (b − 128)/127 or /128 (N-9d). One byte step
  (≈ 0.0079) is below 0.01 and never counts; two or more steps from the reference do [I].
- **Verdicts:**
  - Idle: full throttle into a wall (after the first frame); holding boost; steering with zero throttle.
  - Activity: any press or release of jump, handbrake, boost-hold, air roll or grab; a throttle or pitch-stick change
    ≥ 0.01; steer or yaw changes while throttling.
- **For our server:** keep `last_inputs` per player; run the predicate on each consumed frame with the converted floats;
  don't count the starved-buffer zero input.
