// The page and the local host's worker (local/hostWorker.ts) talk in these messages: the page opens the match and is its
// player PAGE_PLAYER (its control stream's bytes and datagrams, as WebTransport would carry them); the worker hands back
// what the host sends that player, a batch at a time.

/** The page's player in the local match (the bots are 2 and on) */
export const PAGE_PLAYER = 1;

/** A bot in the local match: its team, its name on the scoreboard, its brain (a bot package's id, or a built-in one) */
export interface BotSlot {
  readonly team: 0 | 1;
  readonly name: string;
  readonly brain: string;
}

/** The match to host (on Night, the one map): `teamSize` a side, the kickoff orders from `seed` */
export interface LocalMatchSetup {
  readonly teamSize: number;
  readonly seed: number;
  readonly bots: readonly BotSlot[];
  /** The player's name in it: their account's when signed in, else "Player" (RV-1186) */
  readonly playerName: string;
}

export type ToHost =
  | { readonly type: "open"; readonly setup: LocalMatchSetup; readonly meshes: readonly Uint8Array[]; readonly botsBase: string }
  | { readonly type: "connect" }
  | { readonly type: "control"; readonly bytes: Uint8Array }
  | { readonly type: "datagram"; readonly bytes: Uint8Array }
  | { readonly type: "leave" };

export type FromHost =
  { readonly type: "ready" } | { readonly type: "failed"; readonly reason: string } | { readonly type: "out"; readonly messages: readonly PageMessage[] };

/** What the host sent the page's player: a control message (framed), a datagram, or its stream's end */
export type PageMessage = { readonly kind: "control" | "datagram"; readonly bytes: Uint8Array } | { readonly kind: "end" };
