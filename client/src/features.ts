// Features switched off for now (the user's, 2026-10-24), their code kept: each comes back by flipping its line here (the
// browser tests that need one skip while it's off).

/** Custom Training's button on Play's page (packs can't be uploaded or downloaded yet): off, the button hidden; its packs,
 *  play mode and editor kept */
export const CUSTOM_TRAINING = false as boolean;

/** Play vs Bots (Wisp, MIT, since 2026-10-29; Necto's and Nexto's non-commercial licence had it off): on, a build has
 *  the bots unless CARBALL_BOTS=0 (their packages, onnxruntime and the match host: vite.config.ts); off, none of them, so
 *  no menu entry, no ?bots match, nothing of theirs downloaded */
export const PLAY_VS_BOTS = true as boolean;

/** Whether a build has the bots: CARBALL_BOTS when given ("0" none), else PLAY_VS_BOTS (vite.config.ts; the bots' tests) */
export function botsBuilt(flag: string | undefined): boolean {
  return flag === undefined || flag === "" ? PLAY_VS_BOTS : flag !== "0";
}
