// Online play against the game server: the world is predicted locally with the player's inputs and corrected by the
// server's updates (src/net/predictor.ts). Inputs go out at 60 Hz, two frames per packet plus the unacknowledged ones.
// After a goal the clock slows with the game's (src/game/goalSequence.ts, keyed to the goal's server tick as the
// server's is), then the goal replay plays from this client's own recording of what it drew, until it ends or every
// player skips it (Space / pad A). The team's forfeit vote shows on the HUD, and the menu has its buttons
// (src/game/forfeitVote.ts). Quick chat (src/game/quickChat.ts): the two-press menu on keys 1-4, the presets through the
// server, the chat log with the players' names, their comings and goings.
import { flipAudio, flipVisual } from "../hud";
import { Quaternion, Vector3 } from "three";
import { PlayerCamera } from "../camera/carballCamera";
import type { BodyState, CarConfig, CarState, World } from "../engine/world";
import { type Vec3, add } from "../math/vec";
import { type NetGraphFeed, rawRoundTrip } from "../net/netStats";
import { ESSENTIAL, GAME_UPDATE, type Hud, type ReplayHud, replaySpeed, replayTime, respawnView } from "../hud";
import type { InputDevices } from "../input/devices";
import {
  AirPitchSafety,
  ButtonLatch,
  type ChatKey,
  EMPTY_INPUT,
  chatPresses,
  type HeldActions,
  type InputSnapshot,
  JumpLatch,
  type LookInput,
  NO_HELD_ACTIONS,
  readControls,
  readHeldActions,
} from "../input/mapping";
import { FixedStep, TICK_SECONDS, frameTimes } from "../loop/fixedStep";
import type { Connection } from "../net/connection";
import { NO_INPUT, type Predictor } from "../net/predictor";
import {
  BIT_AIR_PITCH_SAFETY,
  BIT_BOOST,
  BIT_HANDBRAKE,
  BIT_JUMP,
  type ControlMessage,
  type ForfeitVote,
  type InputFrame,
  type MatchPhase,
  type MatchState,
  type MatchType,
  type RosterEntry,
  type ScoreboardEntry,
  quantizeAxis,
} from "../net/protocol";
import { NetSession } from "../net/session";
import { type SessionEnd, idleTipShown, sessionEndReason } from "./sessionEnd";
import { BallView, CarView, trailGround } from "../render/entities";
import type { PadsView } from "../render/tokenPads";
import { DEFAULT_CAR, carChoice } from "./cars";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { GameAudio } from "../audio/audio";
import { type Dodge, FlipTracker } from "./flipTracker";
import { SendClock, cameraInputs, newCar, updateSwitches } from "./cameraInput";
import type { FreeLookControls } from "../camera/carballCamera";
import type { Options, Settings } from "../settings/settings";
import { Interpolated } from "./interpolated";
import { SyncError } from "./syncError";
import { HUD_TEXT, TICK_RATE, clockCue, clockWarning, countdownStep, formatClock, overtimeLabel, shownSeconds } from "./matchClock";
import { fromThreeVector, rotateRl } from "../render/coords";
import { postGoalDilation } from "./goalSequence";
import { type RecordedCar, ReplayRecorder, lastTouchTeam, onlineImpactFrame, recordCar } from "./replayRecorder";
import { ReplayPlayback } from "./replayPlayback";
import { Fade } from "../render/fade";
import { SceneEffects } from "../render/effects";
import { EXPLOSION_LARGE, EXPLOSION_MEDIUM, IMPACT_MEDIUM } from "../camera/shake";
import { ImpactTriggers, triggerSounds } from "./impactTriggers";
import { ServerDemolitions, leaverExplodes } from "./serverDemolitions";
import { ShakeTriggers } from "./shakeTriggers";
import { type MatchMenuItem, matchMenuItems, voteHud } from "./forfeitVote";
import { CHAT_COLOURS, CHAT_TEXT, QuickChatMenu, presetIndex, presetText, visibleGroups } from "./quickChat";
import { CHAT_LOG, type ChatLog, type QuickChatPanel, chatMessageLine, rosterLines } from "../ui/chatLog";
import { goalBanner, scoreboardAllowed, scoreboardTeams, statPopup, tickerRow } from "./matchStats";
import {
  LOAD_FADE_IN,
  PODIUM_FADE_IN,
  PRE_PODIUM_FADE,
  WAITING_MIN_SECONDS,
  WAITING_VIEW,
  WINNERS_EXPLOSION_DELAY,
  dimming,
  onlineHudParts,
  matchOver,
  podiumSpots,
  podiumView,
  winnerBanner,
  winnersGoal,
} from "./matchSequence";
import { EndScreen, type PodiumTags, type ScreenDimming, type WinnerBanner } from "../ui/endOfMatch";
import { shownTitles } from "./podiumTitles";
import { type Nameplates, type Plate, platesAt } from "../ui/nameplates";
import type { CameraView } from "../camera/carballCamera";
import type { HeldScoreboard, ScoreboardView } from "../ui/scoreboard";
import type { StatPopups, StatTicker } from "../ui/statFeed";
import { PLAYER_TEXT, type PlayerItem, type Toast } from "../ui/playersMenu";
import { CHAT_PRESETS } from "./quickChat";
import { inputGlyph } from "../input/bindings";
import { keyGlyph } from "../ui/keyGlyph";
import { BallArrow, ballArrowShown } from "../render/ballArrow";
import { FlipResetFx } from "../render/flipResetFx";

/** The key that opens the menu, which has the vote button (VoteInstructions' {0?KeyBinding}) */
const MENU_KEY = "Esc";
/** A banner message stays this long after the last one (HUD-8: then a 0.3 s fade, not yet drawn) */

interface CarEntry {
  readonly view: CarView;
  /** The garage's car the view draws (src/game/cars.ts: its player's, from the roster) */
  readonly model: number;
  readonly state: Interpolated<CarState>;
  /** How far its drawn pose still is from its corrected one (src/game/syncError.ts) */
  readonly error: SyncError;
}

export interface PhaseChange {
  readonly phase: MatchState["phase"];
  /** When this page handled it (ms, performance.now: at a frame's start) */
  readonly at: number;
  /** How long before that the page last handled its messages (ms): the longest it can have waited in the queue (a long
   *  frame's, a stalled page's), so its arrival lies within `at - waited` and `at` (the browser tests' slack) */
  readonly waited: number;
  readonly frame: number;
  readonly winner: number | null;
  readonly forfeit: boolean;
}

export interface OnlineStats {
  readonly ping: number | null; // ms, smoothed
  readonly ackFrame: number;
  readonly frame: number;
  /** Each car drawn: its place and its garage car (the roster's model, as drawn) */
  readonly cars: readonly { readonly id: number; readonly pos: Vec3; readonly model: number }[];
  /** This player's car */
  readonly localCar: number;
  readonly corrections: number;
  readonly localMispredictions: number;
  readonly kickoffCountdown: number; // ticks left (cars get no input)
  /** The match's phase changes as they arrived: when (performance.now(), ms), at which client frame, and the winner and
   *  whether by forfeit (an ended match's) */
  readonly phases: readonly PhaseChange[];
  /** A goal replay is playing */
  readonly replaying: boolean;
  /** The last goal: the client frame its slow motion is keyed to (the server's goal tick), the first frame its recorded
   *  history has the ball exploded in, and the slowest point of the curve its ticks have run through since (each tick's,
   *  not each drawn frame's: a slow page's frames step past the lowest point, RX31) */
  /** `firstTick`: the first tick after the goal it ran knowing of it (the slow motion from there: a late goal message
   *  starts it past its lowest point, RX32). `offsetSpread`: how far the tick to frame mapping moved around the goal (the
   *  frames the two may differ by) */
  readonly goal: {
    readonly frame: number | null;
    readonly explodedFrame: number | null;
    readonly minDilation: number;
    readonly firstTick: number | null;
    readonly offsetSpread: number;
  };
}

export class Online {
  readonly #world: World;
  readonly #renderer: Renderer;
  readonly #arena: ArenaView;
  readonly #input: InputDevices;
  readonly #hud: Hud;
  readonly #audio: GameAudio;
  #throttle = 0;
  readonly #flipTracker = new FlipTracker();
  #dodge: Dodge = { kind: "ground" };
  #flipReset = false; // since the last frame drawn
  readonly #connection: Connection;
  readonly #localCar: number;
  readonly #predictor: Predictor;
  readonly #clock = new FixedStep();
  readonly #camera = new PlayerCamera();
  readonly #cars = new Map<number, CarEntry>();
  readonly #ballView = new BallView();
  /** The ball arrow by the player's car (HUD-17) */
  readonly #ballArrow = new BallArrow();
  /** The flip reset's effect on our car (HUD-19: the player's own only) */
  readonly #flipFx = new FlipResetFx();
  readonly #ball: Interpolated<BodyState>;
  readonly #ballError: SyncError;
  #drawnBallSpawns = 0; // the ball's spawn counter last drawn (a new ball fades in)
  #serverExploded = false; // the server's goal event exploded the ball, until the next ball
  readonly #padsView: PadsView;
  readonly #controlMessages: ControlMessage[] = [];
  /** When the control messages were last handled (ms, performance.now) */
  #handledAt = performance.now();
  /** The match's state, from the server */
  #match: MatchState | null = null;
  #held: HeldActions = NO_HELD_ACTIONS;
  #ballCam = false;
  #rear = false;
  #look: LookInput = { up: 0, right: 0 };
  #freeLook: FreeLookControls | null = null;
  readonly #pitchSafety = new AirPitchSafety();
  readonly #buttons = new ButtonLatch(); // (buttons as the game's press and release commands: C-4)
  readonly #jump = new JumpLatch(); // (a jump press is a tick of jump however short: LT-4)
  readonly #sendClock = new SendClock();
  #countdownLeft = 0; // whole seconds of the kickoff countdown, for its beeps
  #clockShown: number | null = null; // the clock's shown seconds last frame (its announcements: HUD-10)
  /** The last goal for the replay's banner: who scored and assisted, the clock then, the ball's speed (uu/s) */
  #goal: { readonly scorer: number; readonly assister: number; readonly time: string | null; readonly speed: number | null } | null = null;
  /** The server tick the round's kickoff countdown began at (null: not seen) */
  #roundStartTick: number | null = null;
  /** The camera is the local car's this frame (not the replay, the podium or the joining view: HUD-16) */
  #carView = true;
  #disconnected: string | null = null;
  /** The server's idle warning is on (MM-36) */
  #idleWarning = false;
  /** Why the server kicked this player (KICK_*), before it ends the session */
  #kicked: number | null = null;
  #sessionEnded = false;
  #onSessionEnd: ((why: SessionEnd) => void) | null = null;
  /** The match over told (`onMatchOver`), once */
  #matchOverTold = false;
  /** The match is over (its winner decided, or a no contest), once a match: its saved ranked seat goes (RJ1, RX32). Set
   *  before `onSessionEnd` (an end already come is acted on as that's set) */
  onMatchOver: (() => void) | null = null;
  /** The idle warning's tip (src/ui/idleTip.ts) */
  idleTip: { update(shown: boolean): void } | null = null;
  /** The network core: updates, corrections and their smoothing, the inputs sent (src/net/session.ts) */
  readonly #session: NetSession;
  /** The last goal's server tick (its client frame mapped each time: the frames' numbering can move under a stall, RV-333) */
  #goalTick: number | null = null;
  /** The client frame of the last goal's server tick (the slow motion after it), by the session's current mapping */
  get #goalFrameNow(): number | null {
    return this.#goalTick === null ? null : this.#session.frameAt(this.#goalTick);
  }
  readonly #recorder = new ReplayRecorder();
  #replay: ReplayPlayback | null = null;
  #skipped = false; // asked to skip this replay
  #skipHeld = true; // the skip button down last frame (a press skips)
  #autoSkipSent: boolean;
  readonly #fade = new Fade();
  readonly #effects: SceneEffects;
  readonly #shakeTriggers = new ShakeTriggers({ demolitions: false }); // (the server's Demo events: RV-47)
  /** The predicted world's contacts as the game's impact and landing triggers (notes/impact-triggers.md: every car's,
   *  re-simulated ticks skipped) */
  readonly #impactTriggers = new ImpactTriggers();
  readonly #carConfigs = new Map<number, CarConfig>();
  readonly #demolitions = new ServerDemolitions(); // (the cars drawn demolished: RV-84)
  #localSpawns: number; // the local car's spawn counter last drawn (a kickoff's new car: the camera starts over)
  readonly #phases: PhaseChange[] = [];
  readonly #matchType: MatchType;
  readonly #teamSize: number;
  /** The team's forfeit vote, from the server */
  #vote: ForfeitVote | null = null;
  /** The players by car (null until the first roster), and the cars whose players' connections timed out */
  #roster: Map<number, RosterEntry> | null = null;
  /** Every player's scoreboard line, as the server last sent them */
  #board: readonly ScoreboardEntry[] = [];
  #scoreboardHeld = false;
  /** The players whose chat this player muted (the server's) and blocked (dropped here), by car; this session */
  readonly #muted = new Set<number>();
  readonly #blocked = new Set<number>();
  /** When this client saw the match's phase change (real s): the end's camera and screen timings run from it */
  #phaseSince = 0;
  /** The joining camera (CAM-30): since when it shows (null: not now), and whether it has had its turn */
  #waitingSince: number | null = null;
  #waitingDone = false;
  /** The last view drawn: the sounds' listener when no car of ours is drawn */
  #listener: CameraView | null = null;
  /** The car camera's last view (the pre-podium holds it: CAM-35) */
  #lastView: CameraView | null = null;
  #faded = false; // (the pre-podium's fade to black, started)
  /** The podium's cars, each where first seen (CAM-36), since when the podium shows, its explosion played */
  readonly #podiumCars = new Map<number, Vec3>();
  #podiumSince = 0;
  #podiumExploded = false;
  /** The screen's dimming now, and where the phase's tween started (MIO-20) */
  #dim = { filter: 0, vignette: 0 };
  #dimFrom = { filter: 0, vignette: 0 };
  readonly #lost = new Set<number>();
  readonly #chatMenu = new QuickChatMenu();
  #chatFilterSent = "";
  #minDilation = 1;
  #firstSlowTick: number | null = null;
  #fps = 60;
  readonly #pos = new Vector3();
  readonly #rot = new Quaternion();

  /** `world` already holds the welcome snapshot. */
  constructor(
    world: World,
    renderer: Renderer,
    arena: ArenaView,
    input: InputDevices,
    hud: Hud,
    audio: GameAudio,
    connection: Connection,
    welcome: { readonly carId: number; readonly frame: number; readonly matchType: MatchType; readonly teamSize: number },
    private readonly settings: () => Settings,
    private readonly inputEnabled: () => boolean,
    private readonly chat: { readonly log: ChatLog; readonly panel: QuickChatPanel },
    private readonly statsUi: {
      readonly scoreboard: HeldScoreboard;
      readonly popups: StatPopups;
      readonly ticker: StatTicker;
      readonly toast: Toast;
      readonly nameplates: Nameplates;
    },
    private readonly endUi: { readonly banner: WinnerBanner; readonly dimming: ScreenDimming; readonly tags: PodiumTags; readonly endScreen: EndScreen },
  ) {
    this.#world = world;
    // (the server demolishes: the game's demolition is the authority's alone, a client sees it in the replicated
    // demolish; predicted here a supersonic hit is a bump until the server's state and event say otherwise: RV-112)
    world.setDemolitions(false);
    this.#renderer = renderer;
    this.#arena = arena;
    this.#input = input;
    this.#hud = hud;
    this.#audio = audio;
    this.#connection = connection;
    this.#localCar = welcome.carId;
    this.#matchType = welcome.matchType;
    this.#teamSize = welcome.teamSize;
    this.#session = new NetSession(world, welcome.carId, welcome.frame, this.#cars, {
      sendInputs: (timestamp, first, frames) => {
        connection.sendInputs(timestamp, first, frames);
      },
      resetInputBuffer: () => {
        connection.resetInputBuffer();
      },
      nowMs: () => performance.now(),
    });
    this.#predictor = this.#session.predictor;
    this.#padsView = arena.createPads(world.boostPads());
    this.#ball = this.#session.ball;
    this.#ballError = this.#session.ballError;
    this.#drawnBallSpawns = this.#session.ballSpawns;
    this.#serverExploded = world.ballExploded(); // (joining after a goal: already gone)
    this.#autoSkipSent = settings().options.autoSkipReplay;
    // (the chat filters went in the Hello: RV-259)
    this.#chatFilterSent = `${settings().chat.quickChatFilter}|${String(settings().chat.blockNonTactical)}`;
    this.#localSpawns = world.car(welcome.carId).spawnCount;
    renderer.scene.add(this.#ballView.root, this.#padsView.root, this.#ballArrow.root, statsUi.nameplates.root);
    this.#effects = new SceneEffects(renderer.scene);
    this.#syncCars();
    this.#fade.fromBlack(LOAD_FADE_IN); // (MIO-2: the arena fades in from black as it first draws)
    this.#predictor.onFrame = (frame) => {
      this.#recordFrame(frame);
    };

    connection.onUpdate = (u) => {
      this.#session.receive(u);
      this.statFeed?.received(u, rawRoundTrip(u, performance.now()));
    };
    connection.onSent = (bytes) => {
      this.statFeed?.sent(bytes);
    };
    connection.listen((m) => this.#controlMessages.push(m));
    connection.onClose = (reason) => {
      this.#disconnected = reason;
      this.#session.disconnected = true;
      // (acted on now, not at the next frame: a hidden tab runs none, so a match cancelled before its start (its kick
      // queued) takes its page back to the menu, searching again within the matchmaker's ReturnFor, as the way in
      // already works hidden, RV-354; once the page listens for the end)
      if (this.#onSessionEnd) this.#endFromQueue();
    };
  }

  /** How the session ended, once (a queue match's page goes back to the menu with it); an end already come is acted on
   *  as the handler's set */
  get onSessionEnd(): ((why: SessionEnd) => void) | null {
    return this.#onSessionEnd;
  }

  set onSessionEnd(handler: ((why: SessionEnd) => void) | null) {
    this.#onSessionEnd = handler;
    if (handler && this.#disconnected !== null) this.#endFromQueue();
  }

  /** The session's end acted on outside a frame (a hidden tab's): the queued messages' kick and the match's latest phase
   *  read first (the rest needn't be: the page goes) */
  #endFromQueue(): void {
    if (this.#sessionEnded) return;
    let phase = this.#match?.phase;
    for (const m of this.#controlMessages) {
      if (m.type === "kicked") this.#kicked = m.reason;
      else if (m.type === "match") phase = m.phase;
    }
    if (matchOver(phase)) this.#tellMatchOver();
    this.#watchSessionEnd(phase);
  }

  #tellMatchOver(): void {
    if (this.#matchOverTold) return;
    this.#matchOverTold = true;
    this.onMatchOver?.();
  }

  /** The Stat Graphs' network rows' feed (HUD-21: set by the page) */
  statFeed: NetGraphFeed | null = null;

  /** The viewed car's (this player's) and the ball's velocities (uu/s, game frame: the Stat Graphs' Speed rows) */
  speeds(): { readonly car: Vec3 | null; readonly ball: Vec3 | null } {
    return { car: this.#cars.get(this.#localCar)?.state.current.vel ?? null, ball: this.#ball.current.vel };
  }

  get stats(): OnlineStats {
    return {
      ping: this.#session.ping,
      ackFrame: this.#session.ackFrame,
      frame: this.#predictor.frame,
      cars: [...this.#cars].map(([id, entry]) => ({ id, pos: entry.state.current.pos, model: entry.model })),
      localCar: this.#localCar,
      corrections: this.#predictor.stats.corrections,
      localMispredictions: this.#predictor.stats.localMispredictions,
      kickoffCountdown: this.#world.kickoffCountdown(),
      phases: this.#phases,
      replaying: this.#replay !== null,
      goal: {
        frame: this.#goalFrameNow,
        explodedFrame: this.#explodedFrame(),
        minDilation: this.#minDilation,
        firstTick: this.#firstSlowTick,
        offsetSpread: this.#goalTick === null ? 0 : this.#session.offsetSpread(this.#goalTick - 120, this.#goalTick + 120),
      },
    };
  }

  /** The menu's match buttons now */
  menuItems(): MatchMenuItem[] {
    // (the lobby's leave penalty: every seat's player here, no winner yet, as the server arms it: LV1)
    // (the server's: the lobby full, no winner yet, a forfeit pending or the clock out with the scores apart counting
    // as one, RX32)
    const leavePenalty = this.#match?.leavePenalty ?? false;
    return matchMenuItems({
      matchType: this.#matchType,
      teamSize: this.#teamSize,
      canVoteForfeit: this.#match?.canVoteForfeit ?? false,
      vote: this.#vote,
      leavePenalty,
    });
  }

  /** The menu's forfeit or vote button: both a vote (in a 1v1 the lone player's passes on the press) */
  voteForfeit(): void {
    this.#connection.voteForfeit();
  }

  /** One animation frame. `rawSeconds`: time since the previous frame, unclamped. */
  frame(rawSeconds: number): void {
    this.#handleControlMessages();
    this.#watchSessionEnd();
    this.#session.applyUpdates();
    this.#session.watchHitches(rawSeconds);

    const settings = this.settings();
    const polled = this.#input.snapshot(); // (every frame: a menu's presses mustn't wait for it to close)
    const snapshot = this.inputEnabled() ? polled : EMPTY_INPUT;
    const { bindings, controller, options } = settings;
    const camera = cameraInputs(settings, snapshot, this.#input, this.#camera.fov);
    const held = readHeldActions(snapshot, bindings, controller.deadzone);
    this.#scoreboardHeld = held.scoreboard;
    this.#quickChat(held.chat, settings);
    this.#handleActions(held, options, camera.device.ballCamToggle);
    const raw = readControls(snapshot, bindings, controller.deadzone, this.#buttons);
    this.#jump.frame(this.#buttons);
    const local = this.#cars.get(this.#localCar)?.state.current;
    const safety = this.#pitchSafety.update(options.airPitchSafety, this.#input.usingGamepad, local?.onGround ?? true, raw);
    const input: InputFrame = {
      throttle: quantizeAxis(raw.throttle),
      steer: quantizeAxis(raw.steer),
      pitch: quantizeAxis(raw.pitch),
      yaw: quantizeAxis(raw.yaw),
      roll: quantizeAxis(raw.roll),
      dodgeForward: quantizeAxis(-raw.pitch), // (its own byte, from before the air pitch safety: C-2)
      bits: (raw.boost ? BIT_BOOST : 0) | (raw.handbrake ? BIT_HANDBRAKE : 0) | (safety ? BIT_AIR_PITCH_SAFETY : 0),
    };
    this.#look = camera.look;
    this.#freeLook = camera.freeLook;
    this.#camera.settings = settings.camera;
    this.#camera.shake = options.cameraShake;
    this.#throttle = Math.abs(raw.throttle);
    this.#watchSkip(snapshot);
    if (options.autoSkipReplay !== this.#autoSkipSent) {
      this.#autoSkipSent = options.autoSkipReplay;
      this.#connection.setAutoSkipReplay(options.autoSkipReplay);
    }

    // The frame's world time: slowed after a goal (the dilation the next tick has, as the game applies the curve's
    // value from the frame after)
    const dilation = this.#goalFrameNow === null ? 1 : postGoalDilation(this.#predictor.frame + 1 - this.#goalFrameNow);
    const { world, real } = frameTimes(rawSeconds, dilation);
    const ticks = this.#clock.advance(world);
    if (this.#goalFrameNow !== null) {
      if (ticks > 0) this.#firstSlowTick ??= this.#predictor.frame + 1 - this.#goalFrameNow;
      for (let k = 1; k <= ticks; k++) {
        this.#minDilation = Math.min(this.#minDilation, postGoalDilation(this.#predictor.frame + k - this.#goalFrameNow));
      }
    }
    for (let i = 0; i < ticks; i++) {
      // (after the match the server freezes every car, and in the goal replay the cars are gone: send it nothing then,
      // so the prediction agrees)
      // (and on the podium only the winners drive)
      const phase = this.#match?.phase;
      const frozen = phase === "prePodium" || phase === "finished" || phase === "replay";
      const jumped = { ...input, bits: input.bits | (this.#jump.tick(raw.jump) ? BIT_JUMP : 0) };
      this.#predictor.advance(frozen ? NO_INPUT : this.#disconnected === null ? jumped : { ...input, throttle: 0, bits: 0 });
      this.#world.takeEvents(); // goals come from the server
      this.#pushStates();
      this.#trackFlip();
    }
    // Input packets at 60 Hz of real time, once a frame (slowed ticks after a goal don't stretch them: RV-4)
    // (DeltaSeconds / TimeDilation: the world time undilated, RV-22)
    if (this.#sendClock.due(world / dilation)) this.#session.sendInputs();
    // The countdown: 3, 2, 1 and GO!, a second apart from a second in, each with its beep (VT-24, HUD-8)
    const { left, say } = countdownStep(this.#countdownLeft, this.#world.kickoffCountdown());
    if (say !== null) {
      this.#audio.countdown(left);
      this.#hud.say(say, ESSENTIAL);
    }
    this.#countdownLeft = left;
    this.#announceClock();
    this.#fade.update(real);
    this.#renderer.cameraFade = this.#fade.opacity;
    this.#drawChat();
    if (this.#replay) this.#drawReplay(real, this.#replay);
    else this.#draw(world, ticks * TICK_SECONDS, real);
  }

  /** Quick chat (CHAT-7..9): a press of a chat key opens its category, the next sends that row's preset; not with the
   *  menu up (it closes the panel), the filter Off or disconnected. The chat filters go to the server as they change */
  #quickChat(keys: readonly ChatKey[], settings: Settings): void {
    const now = performance.now() / 1000;
    const { chat } = settings;
    const filter = `${chat.quickChatFilter}|${String(chat.blockNonTactical)}`;
    if (filter !== this.#chatFilterSent) {
      this.#chatFilterSent = filter;
      this.#connection.setChatFilter(chat.quickChatFilter, chat.blockNonTactical);
    }
    const available = this.inputEnabled() && chat.quickChatFilter !== "off" && this.#disconnected === null;
    if (!this.inputEnabled()) this.#chatMenu.close(now);
    const groups = this.#chatGroups(settings);
    for (const i of chatPresses(keys, this.#held.chat)) {
      const press = this.#chatMenu.press(i, now, groups, available);
      if (press.kind !== "send") continue;
      const preset = presetIndex(press.key);
      if (preset !== undefined) this.#connection.quickChat(preset, press.team);
    }
  }

  /** The four categories shown: the match's, or after it the post-game set */
  #chatGroups(settings: Settings): ReturnType<typeof visibleGroups> {
    return visibleGroups(settings.chat.slots, matchOver(this.#match?.phase) ? "ended" : "match");
  }

  /** The quick-chat panel and the chat log, each frame (real time) */
  #drawChat(): void {
    const now = performance.now() / 1000;
    const settings = this.settings();
    const { bindings } = settings;
    const actions = ["chatPreset1", "chatPreset2", "chatPreset3", "chatPreset4"] as const;
    const keys = actions.map((a) => inputGlyph(this.#input.usingGamepad ? bindings[a].gamepad : bindings[a].keyboard));
    this.chat.panel.draw(this.#chatMenu.view(now), this.#chatGroups(settings), presetText, keys);
    // The scoreboard while its binding is held, or pinned on the end screen; the stat popups and the feed
    const board = this.statsUi.scoreboard;
    const phase = this.#match?.phase;
    const view = this.#scoreboardView(settings);
    const since = now - this.#phaseSince;
    if (phase === "finished" && view) {
      board.pin(now, { ...view, winner: this.#match?.winner ?? null }, { shift: EndScreen.menuShift(since) });
    } else {
      board.unpin();
      board.update(now, this.#scoreboardHeld, scoreboardAllowed(phase), view);
    }
    this.statsUi.popups.lowered = phase === "prePodium" || phase === "podium";
    this.statsUi.popups.update(now);
    this.statsUi.ticker.update(now);
    this.statsUi.toast.update(now);
    this.#drawEnd(now);
    // (the idle warning: during play, with the car's camera, MM-36)
    this.idleTip?.update(idleTipShown(this.#idleWarning, phase, this.#replay !== null, this.#disconnected !== null));
    // The log stays up in the menu, after the match (RV-254) and with the scoreboard (4 s after it: SB-10)
    const hold = !this.inputEnabled() || matchOver(phase) || board.shown;
    this.chat.log.update(now, hold, board.shown && phase !== "finished" ? CHAT_LOG.afterScoreboard : CHAT_LOG.hideAfter);
  }

  /** The match's end on screen: the winner banner, the dimming, the podium's name tags, the end screen's menu */
  #drawEnd(now: number): void {
    const match = this.#match;
    const phase = match?.phase;
    const since = now - this.#phaseSince;
    const winner = match?.winner ?? 0;
    this.endUi.banner.update(
      phase === "prePodium" || phase === "podium" ? winnerBanner(match?.winner ?? null, match?.forfeit ?? false) : null,
      phase === "podium",
    );
    this.#dim = dimming(phase, since, this.#dimFrom);
    this.endUi.dimming.update(this.#dim, winner);
    // (the podium's panels: the WinnerMenu's, gone with it on the end screen)
    const titlesOf = (car: number): ReturnType<typeof shownTitles> =>
      shownTitles(this.#board.find((e) => e.car === car)?.titles, this.settings().interface.metric);
    const tags =
      phase === "podium"
        ? [...this.#podiumCars.keys()].flatMap((car) => {
            const entry = this.#cars.get(car);
            const name = this.#roster?.get(car)?.name;
            if (!entry || name === undefined || this.#drawnDemoed(car, entry.state.current)) return [];
            const p = entry.state.current.pos;
            return [{ car, name, side: winner, titles: titlesOf(car), at: this.#renderer.project({ x: p.x, y: p.y, z: -20 }) }];
          })
        : [];
    this.endUi.tags.update(tags);
    const mine = this.#board.find((e) => e.car === this.#localCar);
    const roster = [...(this.#roster?.values() ?? [])];
    const rows = [roster.filter((r) => r.team === 0).length, roster.filter((r) => r.team === 1).length] as const;
    this.endUi.endScreen.update({
      shown: phase === "finished",
      since,
      secondsLeft: match?.secondsLeft ?? 0,
      ready: mine?.ready ?? false,
      accolades: titlesOf(this.#localCar),
      rows,
    });
  }

  /** The end screen's Ready (`SetReadyToPlay` → `ServerReadyUp`: the next match once every player is) */
  readyForNextMatch(): void {
    this.#connection.readyUp();
  }

  /** What the scoreboard shows: the rostered players' lines by team, the score, the player's columns */
  #scoreboardView(settings: Settings): ScoreboardView | null {
    if (!this.#roster) return null;
    const columns = settings.scoreboard.columns;
    return { teams: scoreboardTeams(this.#board, this.#roster, this.#localCar, columns), score: this.#match?.score ?? [0, 0], columns };
  }

  /** The other players for the menu's list, with their mute and block; `bots`: they're the offline match's bots (its
   *  one player the page's own) */
  players(bots = false): PlayerItem[] {
    return [...(this.#roster?.values() ?? [])]
      .filter((p) => p.car !== this.#localCar)
      .map((p) => ({ car: p.car, name: p.name, team: p.team, muted: this.#muted.has(p.car), blocked: this.#blocked.has(p.car), bot: bots }));
  }

  /** Mute (the server stops relaying their chat here) or block (dropped here, with the confirmation's toast) */
  togglePlayer(car: number, what: "mute" | "block"): void {
    const set = what === "mute" ? this.#muted : this.#blocked;
    const on = !set.has(car);
    if (on) set.add(car);
    else set.delete(car);
    if (what === "mute") {
      this.#connection.mute(car, on);
      return;
    }
    const name = this.#roster?.get(car)?.name ?? "";
    this.statsUi.toast.show(name, on ? PLAYER_TEXT.blocked(name) : PLAYER_TEXT.unblocked(name), performance.now() / 1000);
  }

  /** Skip the goal replay: a press of its binding (ReadyUp: Space or the pad's A by default, rebindable), once */
  #watchSkip(snapshot: InputSnapshot): void {
    const { bindings, controller } = this.settings();
    const held = readHeldActions(snapshot, bindings, controller.deadzone).readyUp;
    if (held && !this.#skipHeld && this.#replay && !this.#skipped) {
      this.#skipped = true;
      this.#connection.readyUp();
    }
    this.#skipHeld = held;
  }

  /** The first frame the recording (the history as corrections settled it) has the ball exploded in, near the last
   *  goal's (for the browser tests) */
  #explodedFrame(): number | null {
    if (this.#goalFrameNow === null) return null;
    for (let f = this.#goalFrameNow - 120; f <= this.#goalFrameNow + 120; f++) if (this.#recorder.at(f)?.ballExploded) return f;
    return null;
  }

  /** Whether `car` is drawn demolished: the server's Demo event named it (until it respawns), or its replicated state
   *  says so (a late joiner, an event for a car not here yet: the game replicates the demolish as state, RV-112); never
   *  predicted (the world's demolitions are off) */
  #drawnDemoed(id: number, car: CarState): boolean {
    return this.#demolitions.demoed(id, car.spawnCount) || car.demoed;
  }

  /** What a frame drew, for the goal replay (not while one plays: its frames must stay) */
  #recordFrame(frame: number): void {
    if (this.#replay) return;
    const cars = new Map<number, RecordedCar>();
    // (each car demolished as drawn: the server's, RV-112)
    for (const id of this.#world.carIds()) {
      const car = this.#world.car(id);
      // (a Blender model's wheels as live: RV-581)
      const wheels = this.#cars.get(id)?.view.posesWheels === true ? this.#world.carWheels(id) : null;
      cars.set(id, { ...recordCar(car, wheels), demoed: this.#drawnDemoed(id, car) });
    }
    this.#recorder.record(frame, { cars, ball: this.#world.ball(), ballExploded: this.#world.ballExploded(), lastTouchTeam: lastTouchTeam(this.#world) });
  }

  #handleControlMessages(): void {
    const handled = performance.now();
    const waited = handled - this.#handledAt;
    this.#handledAt = handled;
    for (const m of this.#controlMessages.splice(0)) {
      if (m.type === "world") {
        // (the set of cars changed: the cars in both worlds are smoothed from where they were drawn, as any correction)
        this.#session.reload(m.frame, m.snapshot, () => {
          this.#syncCars();
        });
      } else if (m.type === "match") {
        // The replay over (its end, or everyone skipped): the next camera cuts in from black
        if (this.#replay && m.phase !== "replay") {
          this.#replay.dispose();
          this.#replay = null;
          this.#fade.fromBlack();
          for (const { view } of this.#cars.values()) view.teleport(); // (live again: RV-597)
        }
        if (m.phase !== this.#match?.phase) {
          this.#phases.push({ phase: m.phase, at: handled, waited, frame: this.#predictor.frame, winner: m.winner, forfeit: m.forfeit });
          if (this.#phases.length > 16) this.#phases.shift();
          this.#enterPhase(m.phase, this.#match === null);
          if (matchOver(m.phase) && !matchOver(this.#match?.phase)) this.#tellMatchOver();
          if (!matchOver(m.phase)) this.#matchOverTold = false; // (a rematch's match: told again at its end)
          if (m.phase === "countdown") this.#roundStartTick = m.serverTick; // (the replay's goal time counts from here: HT-6)
        }
        if (m.overtime && this.#match !== null && !this.#match.overtime) {
          this.#hud.say(HUD_TEXT.overtime, GAME_UPDATE); // (HUD-10)
          this.#audio.announcement("overtime"); // (its sound whatever the setting: HT-7, RV-283)
        }
        this.#match = m; // (the score too: the server's)
      } else if (m.type === "event" && m.event.kind === "goal") {
        const team = m.event.team === 1 ? 1 : 0;
        this.#audio.goal();
        this.#hud.say(goalBanner(m.event, this.#roster), ESSENTIAL);
        this.#goalTick = m.serverTick;
        const goalFrame = this.#session.frameAt(m.serverTick);
        // (for the replay's banner: the clock at the goal, the ball's speed in the last frame before it)
        const before = this.#recorder.before(Math.floor(goalFrame) - 1)?.ball.vel;
        this.#goal = {
          scorer: m.event.scorer,
          assister: m.event.assister,
          time: this.#roundStartTick === null ? null : replayTime((m.serverTick - this.#roundStartTick) / TICK_RATE),
          speed: before ? Math.hypot(before.x, before.y, before.z) : null,
        };
        this.#serverExploded = true;
        // (where the ball was at the goal's tick, as this client drew it: RV-52h)
        const at = this.#recorder.before(Math.floor(goalFrame))?.ball.pos ?? this.#world.ball().pos;
        this.#effects.goal(at, team);
        this.#arena.explode();
        this.#camera.shakes.play(EXPLOSION_LARGE, at);
        this.#minDilation = 1;
        this.#firstSlowTick = null;
      } else if (m.type === "event" && m.event.kind === "demo") {
        // A demolition as the server says (QueueDemolish from the replicated demolish): its effect and shake where the
        // victim was at that tick, as this client drew it (RV-47)
        const recorded = this.#recorder.before(Math.floor(this.#session.frameAt(m.serverTick)))?.cars.get(m.event.victim);
        const victim = this.#cars.get(m.event.victim);
        const at = recorded?.pos ?? victim?.state.current.pos;
        // (and the car hidden, its effects killed, the camera switched, all from this frame: RV-84)
        if (victim) this.#demolitions.event(m.event.victim, victim.state.current.spawnCount);
        if (at) {
          this.#effects.demolition(at);
          this.#camera.shakes.play(EXPLOSION_MEDIUM, at);
        }
      } else if (m.type === "event" && m.event.kind === "left") {
        // A player left: their car explodes where it's drawn (Car.Demolish(None)), then the world without it reloads
        if (m.event.lost) this.#lost.add(m.event.car);
        const car = this.#cars.get(m.event.car);
        if (leaverExplodes(m.event, car !== undefined, this.#replay !== null) && car) {
          const pos = add(car.state.blended(this.#clock.alpha).pos, car.error.location);
          this.#effects.demolition(pos);
          this.#camera.shakes.play(EXPLOSION_MEDIUM, pos);
          this.#audio.demolition(pos);
        }
      } else if (m.type === "roster") {
        // The players: the log says who came and went (not those already here as this player joined)
        const next = new Map(m.players.map((p) => [p.car, p]));
        const now = performance.now() / 1000;
        if (this.#roster) for (const line of rosterLines(this.#roster, next, this.#lost)) this.chat.log.add(line, now);
        this.#roster = next;
        this.#syncCars();
      } else if (m.type === "chat") {
        // A quick-chat line, as the server relayed it (one's own too: no local echo), with its sound; not a blocked
        // player's, nor an unknown preset's or sender's (RV-260)
        const roster = this.#roster;
        if (this.#blocked.has(m.car) || !CHAT_PRESETS[m.preset] || !roster?.has(m.car)) continue;
        const match = this.#match;
        const view = { localCar: this.#localCar, roster, overtime: match?.overtime ?? false, ended: matchOver(match?.phase) };
        this.chat.log.add(chatMessageLine(m, view), performance.now() / 1000);
        this.#audio.chatMessage();
      } else if (m.type === "chatBlocked") {
        // (the spam filter's notice: a system line, silent)
        this.chat.log.add(
          { timestamp: "", channel: null, name: null, text: CHAT_TEXT.disabled(m.seconds), colour: CHAT_COLOURS.system },
          performance.now() / 1000,
        );
      } else if (m.type === "scoreboard") {
        this.#board = m.players;
      } else if (m.type === "statEvent") {
        const popup = statPopup(m.event, m.points, this.settings().gameplay.statDisplayLevel);
        if (popup) this.statsUi.popups.push(popup);
      } else if (m.type === "ticker") {
        const row = tickerRow(m, this.#roster ?? new Map<number, RosterEntry>(), this.#localCar, this.settings().gameplay.statDisplayLevel);
        if (row) this.statsUi.ticker.add(row, performance.now() / 1000);
      } else if (m.type === "forfeitVote") {
        this.#vote = { state: m.state, yes: m.yes, required: m.required, secondsLeft: m.secondsLeft, voted: m.voted, canStart: m.canStart };
      } else if (m.type === "idleWarning") {
        this.#idleWarning = m.on;
      } else if (m.type === "kicked") {
        this.#kicked = m.reason;
      } else if (m.type === "replay") {
        // (the cut in from black: LiveReplay's Begin)
        this.#replay?.dispose();
        this.#replay = new ReplayPlayback(m, this.#recorder, (tick) => this.#session.frameAt(tick));
        for (const { view } of this.#cars.values()) view.teleport(); // (the replay's first frame: RV-597)
        this.#ballView.spawn();
        this.#arena.newBall();
        this.#skipped = false;
        this.#skipHeld = true;
        this.#hud.say("");
        this.#fade.fromBlack();
      }
      // (replayReady: the game shows the names of the players not ready, not a count, MR-6.14: with player names)
    }
  }

  /** The session's end, once its messages are read: a kick's reason (idle, a match cancelled before its start), the
   *  match over (the end screen: the server lets a queue match go), else a lost connection */
  #watchSessionEnd(phase: MatchPhase | undefined = this.#match?.phase): void {
    if (this.#disconnected === null || this.#sessionEnded) return;
    this.#sessionEnded = true;
    this.#onSessionEnd?.(sessionEndReason(this.#kicked, phase));
  }

  /** A new phase as this client sees it (MIO-16: the end's timings run from here). `first`: the first match state after
   *  joining */
  #enterPhase(phase: MatchPhase, first: boolean): void {
    const now = performance.now() / 1000;
    this.#phaseSince = now;
    this.#dimFrom = this.#dim;
    // (the server's world: frozen at the end and on the end screen, the podium's boost unlimited)
    this.#world.setFrozen(phase === "prePodium" || phase === "finished");
    this.#world.setUnlimitedBoost(phase === "podium");
    this.#world.setPodium(phase === "podium" || phase === "finished");
    // CAM-30: joining in the match's warm-up, the side view first (once)
    if (first && phase === "waiting" && !this.#waitingDone) this.#waitingSince = now;
    if (phase === "prePodium") this.#faded = false;
    if (phase === "podium") {
      // CAM-36: a cut from the pre-podium's black, fading in over 0.25 s; the ball gone (HideBalls)
      this.#podiumCars.clear();
      this.#podiumSince = now;
      this.#podiumExploded = false;
      this.#serverExploded = true;
      this.#fade.fromBlack(PODIUM_FADE_IN);
    }
  }

  /** Views for the cars in the world (after a join or leave, and a roster), each the garage's car its player drives: the
   *  default until the roster names theirs, the view made anew when it names another (its pose and correction kept) */
  #syncCars(): void {
    const ids = new Set(this.#world.carIds());
    for (const [id, entry] of this.#cars) {
      if (!ids.has(id)) {
        this.#renderer.scene.remove(entry.view.root);
        entry.view.dispose();
        this.#cars.delete(id);
        this.#demolitions.forget(id);
      }
    }
    for (const id of ids) {
      const model = carChoice(this.#roster?.get(id)?.model ?? DEFAULT_CAR).id;
      const entry = this.#cars.get(id);
      if (entry?.model === model) continue;
      const state = this.#world.car(id);
      const view = new CarView(this.#world.carConfig(id), state.team, this.#effects.particles, model);
      // (the old view's flip effect, if it had it, comes back on the next frame's attach)
      if (entry) {
        this.#renderer.scene.remove(entry.view.root);
        entry.view.dispose();
      }
      this.#renderer.scene.add(view.root);
      this.#cars.set(id, { view, model, state: entry?.state ?? new Interpolated(state), error: entry?.error ?? new SyncError() });
    }
  }

  #pushStates(): void {
    for (const [id, entry] of this.#cars) {
      // (a respawn or reset predicted here is drawn at once, not interpolated across the field for a tick: NR-8)
      const car = this.#world.car(id);
      const spawned = car.spawnCount !== entry.state.current.spawnCount;
      entry.state.push(car, spawned);
      if (spawned) entry.view.teleport(); // (a new car: its sway and wheels fresh, RV-597)
    }
    const ballSpawns = this.#world.ballSpawnCount();
    this.#ball.push(this.#world.ball(), ballSpawns !== this.#session.ballSpawns);
    this.#session.ballSpawns = ballSpawns;
  }

  /** Whether the player's car can dodge, after this tick (the flip indicator). */
  #trackFlip(): void {
    const local = this.#cars.get(this.#localCar)?.state.current;
    if (!local) return;
    const { dodge, reset } = this.#flipTracker.tick(local, TICK_SECONDS);
    this.#dodge = dodge;
    if (reset) this.#flipReset = true;
  }

  #handleActions(held: HeldActions, options: Options, ballCamToggle: boolean): void {
    const phase = this.#match?.phase;
    const blocked = phase === "replay" || matchOver(phase);
    const next = updateSwitches({ ballCam: this.#ballCam, rear: this.#rear }, held, this.#held, {
      ballCamToggle,
      rearCameraToggle: options.rearCameraToggle,
      blocked,
    });
    this.#ballCam = next.ballCam;
    this.#rear = next.rear;
    this.#held = held; // (freeplay's reset and ball placement do nothing online)
  }

  /** `frameSeconds`: the frame's world time (slowed after a goal); `simulated`: seconds of physics run this frame;
   *  `realSeconds`: real time since the last frame. */
  #draw(frameSeconds: number, simulated: number, realSeconds: number): void {
    const alpha = this.#clock.alpha;
    let localDrawn: Vec3 | null = null;
    for (const [id, { view, state, error }] of this.#cars) {
      error.decay(frameSeconds);
      const { boosting, supersonic } = state.current;
      // (demolished as the server says: RV-84)
      const demoed = this.#drawnDemoed(id, state.current);
      const pos = error.applyPosition(state.position(alpha, this.#pos));
      if (id === this.#localCar && !demoed) localDrawn = fromThreeVector(pos);
      const throttling = (id === this.#localCar ? this.#throttle : Math.abs(this.#world.carControls(id).throttle)) > 0;
      // (a Blender model's wheels: the vehicle's suspension and steering, as this page's world has them)
      if (view.posesWheels) view.wheels = demoed ? null : { ...this.#world.carWheels(id), contact: state.current.wheelContact };
      view.update(
        pos,
        error.applyRotation(state.rotation(alpha, this.#rot)),
        boosting,
        demoed,
        supersonic,
        frameSeconds,
        trailGround(state.current),
        throttling,
      );
    }
    this.#ballError.decay(frameSeconds);
    const ball = this.#ballError.applyPosition(this.#ball.position(alpha, this.#pos));
    // (a goal explodes it, as the server says, until the reset: it dissolves; a kickoff's new ball is solid at once. Not
    // the prediction's explosion: a mispredicted goal would dissolve it for a round trip, RV-32)
    if (this.#world.ballSpawnCount() !== this.#drawnBallSpawns) {
      this.#drawnBallSpawns = this.#world.ballSpawnCount();
      this.#serverExploded = false;
      this.#ballView.spawn();
      this.#arena.newBall();
    }
    // (the ball's trail in the last touch's team colour; none on the podium: VT-10, VT-10a)
    this.#ballView.trailTeam = lastTouchTeam(this.#world);
    this.#ballView.trailShown = this.#match?.phase !== "prePodium" && this.#match?.phase !== "podium" && this.#match?.phase !== "finished";
    this.#ballView.fade(this.#serverExploded, frameSeconds);
    // The ball arrow (HUD-17): the setting on, the ball cam off, in the round (the countdown, play, after a goal)
    const roundPhase = this.#match?.phase;
    const round = roundPhase === "countdown" || roundPhase === "active" || roundPhase === "postGoal" || roundPhase === "timeUp";
    const arrow = ballArrowShown(this.settings().interface.ballArrow, this.#ballCam, localDrawn !== null, round && this.#carView);
    this.#ballArrow.update(arrow ? localDrawn : null, fromThreeVector(ball), frameSeconds, this.#serverExploded);
    this.#cars.get(this.#localCar)?.view.attach(this.#flipFx.root);
    this.#flipFx.update(frameSeconds);
    this.#ballView.update(ball, this.#ballError.applyRotation(this.#ball.rotation(alpha, this.#rot)));
    this.#arena.update(ball, frameSeconds);
    this.#effects.update(frameSeconds);
    const pads = this.#world.boostPads();
    const states = new Map([...this.#cars].map(([id, entry]) => [id, entry.state.current]));
    this.#shakeTriggers.frame(this.#camera.shakes, this.#cars.get(this.#localCar)?.state.current, states, pads, () => undefined);
    for (const id of states.keys()) if (!this.#carConfigs.has(id)) this.#carConfigs.set(id, this.#world.carConfig(id));
    const impacts = this.#world.takeImpacts();
    // (the goal replay's ball hits: the engine's car–ball impacts, a correction's re-simulated ones too, at their frames:
    // the world's ticks and the client's frames step together; none kept while a replay plays, RX30C)
    if (!this.#replay) this.#recorder.ballImpacts(impacts, onlineImpactFrame(this.#world.tick, this.#predictor.frame));
    const triggers = this.#impactTriggers.frame(frameSeconds, impacts, states, this.#carConfigs, this.#localCar);
    for (const t of triggers) if (t.kind === "shake") this.#camera.shakes.play(IMPACT_MEDIUM, null, t.scale, `impact:${String(t.car)}`);
    this.#padsView.update(pads, frameSeconds);

    const local = this.#cars.get(this.#localCar);
    // A kickoff's new car (the game destroys the cars and spawns new ones): the camera starts over behind it (GS-16);
    // a respawn after a demolition blends as usual
    const spawns = local?.state.current.spawnCount;
    if (spawns !== undefined && spawns !== this.#localSpawns) {
      this.#localSpawns = spawns;
      if (this.#world.kickoffCountdown() > 0) this.#camera.reset();
      this.#rear = newCar({ ballCam: this.#ballCam, rear: this.#rear }).rear;
    }
    let view: CameraView | null = null;
    if (local) {
      // The camera follows the drawn (smoothed) car and ball, its rotation too
      const car = local.state.blended(alpha);
      const e = local.error.rotation;
      const rot = { forward: rotateRl(car.rot.forward, e), right: rotateRl(car.rot.right, e), up: rotateRl(car.rot.up, e) };
      const demoed = this.#drawnDemoed(this.#localCar, local.state.current);
      const drawnCar = { ...car, pos: add(car.pos, local.error.location), rot, demoed };
      const drawnBall = add(this.#ball.blended(alpha).pos, this.#ballError.location);
      // Demolished: the respawn cameras follow the spot picked (respawns wait after a goal: CAM-29)
      const { spawnSelection: pick, team } = local.state.current;
      const phase = this.#match?.phase;
      const respawn = demoed
        ? {
            held: phase === "postGoal" || phase === "replay",
            selected: pick.side === null ? null : (this.#world.respawnSpots(team, pick.side)[pick.index] ?? null),
          }
        : null;
      const controls = { ballCam: this.#ballCam, rear: this.#rear, lookUp: this.#look.up, lookRight: this.#look.right, freeLook: this.#freeLook };
      const carView = this.#camera.update(frameSeconds, drawnCar, drawnBall, controls, respawn, realSeconds);
      if (this.#camera.takeBallCamExit()) this.#ballCam = false; // (free look left the toggled ball cam)
      view = this.#matchView(carView);
      this.#listener = view;
    }
    // The sounds every frame, through the match's end too (the user's finding 24: they stuck at the cars' last state):
    // heard from the view drawn (the last one without a car of ours), every car in the world now (a removed car's voice
    // stops); frozen at the end, the cars halted and still (the game's halt their physics), the podium's winners heard
    // as they drive
    const listener = view ?? this.#listener;
    if (listener) {
      const phase = this.#match?.phase;
      const frozen = phase === "prePodium" || phase === "finished";
      const still = { vel: { x: 0, y: 0, z: 0 }, boosting: false, supersonic: false };
      // (its sounds kept for a goal replay to hear again: RA1 §1)
      const played = this.#audio.frame({
        // (the demolitions as drawn, the server's: the explosion's sound with its effect, RV-84)
        world: {
          cars: new Map(
            [...this.#cars].map(([id, entry]) => [
              id,
              { ...entry.state.current, ...(frozen ? still : {}), demoed: this.#drawnDemoed(id, entry.state.current) },
            ]),
          ),
          ball: this.#ball.current,
          pads,
        },
        localCar: this.#localCar,
        throttle: frozen ? 0 : this.#throttle,
        simulated,
        camera: listener,
        triggered: triggerSounds(triggers),
      });
      this.#recorder.sounds(played);
    }
    // (drawn after the sounds: they start as soon as the frame knows them, not after drawing it)
    if (view) {
      this.#renderer.render(view);
      this.#effects.camera = view.position; // (the husks collide near it)
      this.#drawNameplates(alpha);
    }

    this.#updateHud(realSeconds);
  }

  /** HUD-13: the other cars' nameplates as drawn (none for a demolished car, nor on the podium and after: its panels);
   *  `replayCars`: the goal replay's cars as it draws them (every car's plate tracks them: HT-8, RV-279) */
  #drawNameplates(alpha: number, replayCars: ReadonlyMap<number, { readonly pos: Vec3; readonly team: number }> | null = null): void {
    const ui = this.settings().interface;
    const phase = this.#match?.phase;
    const live = this.#carView && phase !== "podium" && phase !== "finished" && phase !== "prePodium";
    const project = (top: Vec3): Plate["at"] => {
      const scale = this.#renderer.scaleAt(top);
      const at = scale ? this.#renderer.project(top) : null;
      return at && scale ? { ...at, ...scale } : null;
    };
    // (live: the others' cars as drawn; the replay: every car, the player's own saying YOU)
    const cars =
      replayCars ??
      new Map(
        live
          ? [...this.#cars].flatMap(([id, entry]) =>
              id === this.#localCar || this.#drawnDemoed(id, entry.state.current)
                ? []
                : [[id, { pos: add(entry.state.blended(alpha).pos, entry.error.location), team: entry.state.current.team }] as const],
            )
          : [],
      );
    const plates = platesAt(cars, this.#localCar, (id) => this.#roster?.get(id)?.name ?? "", project);
    this.statsUi.nameplates.update(plates, ui.nameplateMode, ui.nameplateScale, ui.hideHud);
  }

  /** The view the phase calls for (notes/match-intro-outro.md): the side view while joining in the warm-up (CAM-30,
   *  3 s at least, once), the last car view held before the podium with its fade to black from 2.5 s (CAM-35), the
   *  podium's dolly through the end screen (CAM-36) with the winners' explosion 0.6 s in (MIO-12); else the car's */
  #matchView(carView: CameraView): CameraView {
    const now = performance.now() / 1000;
    const phase = this.#match?.phase;
    this.#carView = false; // (until the car's own view is the one returned)
    if (this.#waitingSince !== null) {
      if (phase === "waiting" && now - this.#waitingSince < WAITING_MIN_SECONDS) return WAITING_VIEW;
      this.#waitingSince = null; // (a cut to the car)
    }
    this.#waitingDone = true;
    if (phase === "prePodium") {
      if (!this.#faded && now - this.#phaseSince >= PRE_PODIUM_FADE.delay) {
        this.#faded = true;
        this.#fade.toBlack(PRE_PODIUM_FADE.duration);
      }
      return this.#lastView ?? carView;
    }
    if (phase === "podium" || phase === "finished") {
      const winner = this.#match?.winner ?? 0;
      for (const [id, entry] of this.#cars) {
        const car = entry.state.current;
        if (car.team === winner && !this.#drawnDemoed(id, car) && !this.#podiumCars.has(id)) this.#podiumCars.set(id, car.pos);
      }
      if (phase === "podium" && !this.#podiumExploded && now - this.#podiumSince >= WINNERS_EXPLOSION_DELAY) {
        this.#podiumExploded = true;
        const at = winnersGoal(winner);
        this.#effects.goal(at, winner);
        this.#audio.goal();
      }
      // (framed on the spots, not the cars as last seen: their placement reaches us a datagram after the phase, RV-273)
      const winners = [...(this.#roster?.values() ?? [])].filter((r) => r.team === winner).length;
      const count = Math.max(winners, this.#podiumCars.size);
      if (count > 0) return podiumView(podiumSpots(winner, count), winner, now - this.#podiumSince);
      return carView;
    }
    this.#lastView = carView;
    this.#carView = true;
    return carView;
  }

  /** The clock's announcements while it runs in regulation (HUD-10), each of the last ten seconds with a beep */
  #announceClock(): void {
    const match = this.#match;
    if (!match || match.overtime || match.phase !== "active") {
      this.#clockShown = null;
      return;
    }
    const now = shownSeconds(match);
    const say = this.#clockShown === null ? null : clockWarning(this.#clockShown, now);
    this.#clockShown = now;
    if (say === null) return;
    // (each its own sound, whatever the setting: HT-7, RV-283)
    const cue = clockCue(now);
    if (cue === "endCounter") this.#audio.endCounter();
    else this.#audio.announcement(cue);
    this.#hud.say(say, GAME_UPDATE);
  }

  /** The HUD; `replay`: the goal replay's banner (null: not in one) */
  #updateHud(realSeconds: number, replay: ReplayHud | null = null): void {
    if (realSeconds > 0) this.#fps += (1 / realSeconds - this.#fps) * 0.05;
    const car = this.#cars.get(this.#localCar)?.state.current;
    const ping = this.#session.ping === null ? "ping –" : `ping ${String(Math.round(this.#session.ping))} ms`;
    const settings = this.settings();
    const pad = this.#input.usingGamepad;
    const toggles = (pad ? settings.cameraPad : settings.cameraKbm).ballCamToggle;
    const ballCamKey = keyGlyph(pad ? settings.bindings.ballCam.gamepad : settings.bindings.ballCam.keyboard);
    const phase = this.#match?.phase;
    this.#hud.update({
      boost: car?.boost ?? 0,
      speed: car ? Math.hypot(car.vel.x, car.vel.y, car.vel.z) : 0,
      supersonic: car?.supersonic ?? false,
      score: this.#match?.score ?? [0, 0],
      clock: this.#match ? formatClock(this.#match) : null,
      overtimeLabel: this.#match ? overtimeLabel(this.#match) : false,
      localTeam: car?.team ?? 0,
      ballCam: this.#ballCam,
      ballCamKey: toggles ? ballCamKey : null,
      carView: replay === null && this.#carView,
      menuOpen: !this.inputEnabled(),
      message: this.#disconnected !== null ? `Disconnected: ${this.#disconnected}` : null,
      replay,
      fps: this.#fps,
      net: `${ping} · ${this.#session.bufferText} · ${String(this.#cars.size)} cars`,
      flip: flipVisual(settings.gameplay.flipResetIndicator) ? this.#dodge : null,
      flipReset: this.#flipReset,
      respawn: respawnView(car, this.#match, {
        left: keyGlyph(pad ? settings.bindings.steerLeft.gamepad : settings.bindings.steerLeft.keyboard),
        right: keyGlyph(pad ? settings.bindings.steerRight.gamepad : settings.bindings.steerRight.keyboard),
      }),
      vote: voteHud(this.#vote, this.#matchType, MENU_KEY, matchOver(phase)),
      // (demolished: no car's HUD, the boost meter and the ball cam indicator gone: HUD-16's bShowCarHUD, RV-513)
      parts: onlineHudParts(phase, car?.demoed ?? false),
    });
    if (this.#flipReset && flipAudio(this.settings().gameplay.flipResetIndicator)) this.#audio.flipReset();
    if (this.#flipReset && flipVisual(this.settings().gameplay.flipResetIndicator)) this.#flipFx.trigger();
    this.#flipReset = false;
  }

  /** The goal replay (src/game/replayPlayback.ts) over this client's recording. `realSeconds`: real time since the
   *  last frame. */
  #drawReplay(realSeconds: number, playback: ReplayPlayback): void {
    const cars = [...this.#cars].map(([id, entry]) => [id, entry.view] as const);
    this.#ballArrow.update(null, null); // (not in a replay: HUD-17)
    playback.frame(realSeconds, {
      renderer: this.#renderer,
      arena: this.#arena,
      effects: this.#effects,
      audio: this.#audio,
      ballView: this.#ballView,
      cars,
      flipReset: { visual: flipVisual(this.settings().gameplay.flipResetIndicator), audio: flipAudio(this.settings().gameplay.flipResetIndicator) },
    });
    this.#drawNameplates(0, playback.cars);
    // (SkipInstructions until the player skips: its binding's key, HT-3)
    const goal = this.#goal;
    const { bindings } = this.settings();
    const skipKey = keyGlyph(this.#input.usingGamepad ? bindings.readyUp.gamepad : bindings.readyUp.keyboard);
    const named = (car: number): { readonly name: string; readonly team: number } | null => {
      const entry = car === 0 ? undefined : this.#roster?.get(car);
      return entry ? { name: entry.name, team: entry.team } : null;
    };
    this.#updateHud(realSeconds, {
      prompt: this.#skipped ? null : skipKey,
      waiting: null,
      goal: goal && {
        scorer: named(goal.scorer),
        assister: named(goal.assister),
        time: goal.time,
        speed: goal.speed === null ? null : replaySpeed(goal.speed, this.settings().interface.metric),
      },
    });
  }
}
