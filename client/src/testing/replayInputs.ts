// Players' inputs from replays, for the network tests' remote-input comparison (T5, notes/netcode-live.md §13): the
// replay extract's states.csv (scripts/replay_extract.py; local only, git-ignored) holds each car's replicated throttle
// and steer bytes, handbrake, and its components' active flags (boost, jump, double jump, dodge, the dodge's torque) as
// the recording client received them. Each car's rows become a 120 Hz stream of input frames (values held between
// rows): the bytes as the input bytes (b − 128), boost and handbrake as held, the jump button held while the jump is
// active and pressed for 3 ticks as a double jump or dodge starts (the dodge's direction from its torque). Pitch, yaw
// and roll aren't replicated: yaw follows the steer (as a keyboard or a stick on the ground does), pitch and roll 0.
// A player's actors (one per spawn) are joined in the order they appear, per team slot.
import { existsSync, readFileSync } from "node:fs";
import { BIT_BOOST, BIT_HANDBRAKE, BIT_JUMP, type InputFrame } from "../net/protocol";

const TICK_RATE = 120;
/** A double jump or dodge start: the jump button down this long */
const PRESS_TICKS = 3;

interface Row {
  readonly tick: number;
  readonly throttle: number;
  readonly steer: number;
  readonly handbrake: boolean;
  readonly boosting: boolean;
  readonly jump: boolean;
  readonly doubleJump: boolean;
  readonly dodge: boolean;
  readonly torqueX: number;
  readonly torqueY: number;
}

/** Each replay's players' input streams (team 0's slots, then team 1's), by replay name; null without the file */
export function replayInputStreams(csvPath: string, which: (replay: string) => boolean): Map<string, InputFrame[][]> | null {
  if (!existsSync(csvPath)) return null;
  const lines = readFileSync(csvPath, "utf8").split("\n");
  const header = (lines[0] ?? "").split(",");
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`states.csv: no ${name} column`);
    return i;
  };
  const c = {
    replay: col("replay"),
    time: col("time"),
    kind: col("kind"),
    actor: col("actor"),
    team: col("team"),
    throttle: col("throttle"),
    steer: col("steer"),
    handbrake: col("handbrake"),
    boosting: col("boosting"),
    jump: col("jump"),
    doubleJump: col("double_jump"),
    dodge: col("dodge"),
    torqueX: col("dodge_torque_x"),
    torqueY: col("dodge_torque_y"),
  };
  // replay -> team -> actor -> rows
  const replays = new Map<string, { start: number; teams: Map<number, Map<number, Row[]>> }>();
  for (let i = 1; i < lines.length; i++) {
    const f = (lines[i] ?? "").split(",");
    if (f[c.kind] !== "car") continue;
    const name = f[c.replay] ?? "";
    if (!which(name)) continue;
    const time = Number(f[c.time]);
    let replay = replays.get(name);
    if (!replay) {
      replay = { start: time, teams: new Map() };
      replays.set(name, replay);
    }
    const team = Number(f[c.team]);
    const actor = Number(f[c.actor]);
    let actors = replay.teams.get(team);
    if (!actors) {
      actors = new Map();
      replay.teams.set(team, actors);
    }
    let rows = actors.get(actor);
    if (!rows) {
      rows = [];
      actors.set(actor, rows);
    }
    rows.push({
      tick: Math.round((time - replay.start) * TICK_RATE),
      throttle: Number(f[c.throttle]),
      steer: Number(f[c.steer]),
      handbrake: f[c.handbrake] === "1",
      boosting: f[c.boosting] === "1",
      jump: f[c.jump] === "1",
      doubleJump: f[c.doubleJump] === "1",
      dodge: f[c.dodge] === "1",
      torqueX: Number(f[c.torqueX]) || 0,
      torqueY: Number(f[c.torqueY]) || 0,
    });
  }
  const out = new Map<string, InputFrame[][]>();
  for (const [name, replay] of replays) {
    const streams: InputFrame[][] = [];
    for (const team of [...replay.teams.keys()].sort((a, b) => a - b)) {
      // The team's actors in the order they appear, each in the first slot free by then (one player's spawns)
      const segments = [...(replay.teams.get(team)?.values() ?? [])].sort((a, b) => (a[0]?.tick ?? 0) - (b[0]?.tick ?? 0));
      const slots: Row[][] = [];
      for (const rows of segments) {
        const first = rows[0]?.tick ?? 0;
        const slot = slots.find((s) => (s.at(-1)?.tick ?? -1) < first);
        if (slot) slot.push(...rows);
        else slots.push([...rows]);
      }
      for (const rows of slots) streams.push(toFrames(rows));
    }
    out.set(name, streams);
  }
  return out;
}

/** A player's rows as 120 Hz input frames, each row's values held to the next */
function toFrames(rows: readonly Row[]): InputFrame[] {
  const end = rows.at(-1)?.tick ?? 0;
  const frames: InputFrame[] = [];
  let r = 0;
  let row: Row | undefined;
  let pressLeft = 0;
  let pressPitch = 0;
  let pressYaw = 0;
  let before: Row | undefined;
  for (let t = 0; t <= end; t++) {
    while (r < rows.length && (rows[r]?.tick ?? Infinity) <= t) row = rows[r++];
    if (row && row !== before) {
      // A double jump or dodge starting: the jump button pressed (a dodge toward its torque's direction)
      if ((row.doubleJump && !before?.doubleJump) || (row.dodge && !before?.dodge)) {
        pressLeft = PRESS_TICKS;
        const forward = row.torqueY;
        const side = -row.torqueX;
        const length = Math.hypot(forward, side);
        pressPitch = row.dodge && length > 0 ? Math.round((-forward / length) * 127) : 0;
        pressYaw = row.dodge && length > 0 ? Math.round((side / length) * 127) : 0;
      }
      before = row;
    }
    if (!row) {
      frames.push({ throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, dodgeForward: 0, bits: 0 });
      continue;
    }
    const steer = row.steer - 128;
    const pressing = pressLeft > 0;
    if (pressing) pressLeft--;
    frames.push({
      throttle: row.throttle - 128,
      steer,
      pitch: pressing ? pressPitch : 0,
      yaw: pressing && pressYaw !== 0 ? pressYaw : steer,
      roll: 0,
      dodgeForward: pressing ? -pressPitch : 0,
      bits: (row.jump || pressing ? BIT_JUMP : 0) | (row.boosting ? BIT_BOOST : 0) | (row.handbrake ? BIT_HANDBRAKE : 0),
    });
  }
  return frames;
}
