// The match's worker (src/local/hostWorker.ts) as the page drives it: opened on a setup, the page's player connected and
// welcomed, then its leave: the host dropped, its ticks stopped, the page's later messages ignored (RV-538 CM20). Run here
// with the engine's Node build in place of its web one, the worker's `self` a stand-in.
import { afterAll, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION, encodeControl } from "../net/protocol";
import { arenaMeshes } from "../testing/arena";
import type { FromHost, ToHost } from "./hostMessages";

vi.mock("@engine/carball_engine_web.mjs", async () => ({ default: (await import("@engine/carball_engine.mjs")).default }));

const posted: FromHost[] = [];
const worker = { postMessage: (message: FromHost): void => void posted.push(message), onmessage: null as ((event: { data: ToHost }) => void) | null };
const global = globalThis as unknown as { self?: unknown };
const before = global.self;
global.self = worker;
afterAll(() => {
  global.self = before;
});

const send = (data: ToHost): void => {
  worker.onmessage?.({ data });
};
const hello = encodeControl({
  type: "hello",
  version: PROTOCOL_VERSION,
  team: 0,
  model: 0,
  dodgeDeadzone: 0.5,
  steeringSensitivity: 1,
  airControlSensitivity: 1,
  autoSkipReplay: true,
  key: 0n,
  name: "Player",
  quickChat: "everyone",
  blockNonTactical: false,
  intent: "join",
  playlist: 0,
  token: 0n,
});
const outs = (): number => posted.filter((m) => m.type === "out").length;

describe("the match's worker", () => {
  it("welcomes the page's player, and after its leave drops the host: nothing more sent, a new hello unanswered", async () => {
    await import("./hostWorker");
    send({ type: "open", setup: { teamSize: 1, seed: 3, bots: [{ team: 1, name: "Chaser", brain: "chaser" }] }, meshes: arenaMeshes(), botsBase: "/bots/" });
    await vi.waitFor(() => {
      expect(posted.some((m) => m.type === "ready")).toBe(true);
    }, 60_000);
    send({ type: "connect" });
    send({ type: "control", bytes: hello });
    await vi.waitFor(() => {
      expect(outs()).toBeGreaterThan(0);
    }, 10_000);
    send({ type: "leave" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = outs();
    // (a hello again: a kept host would welcome it, its ticks going on)
    send({ type: "connect" });
    send({ type: "control", bytes: hello });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(outs()).toBe(after);
    expect(posted.some((m) => m.type === "failed")).toBe(false);
  }, 120_000);
});
