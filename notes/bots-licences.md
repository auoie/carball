# Commercial-safe bot candidates: licences, strength, port notes (BOTS2, 2026-10-24)

Web research only: GitHub pages, raw files, the GitHub REST API (trees, commit lists), wiki.rlbot.org, rlbot.org and arXiv.
Nothing was cloned, installed or run, and no weights were opened. One model file (Levi's `levi.mdl`, 8,128 bytes) was fetched
by mistake and deleted unopened (see the hand-back). These licence readings are research notes, **not legal advice**.
"Pinned" means the commit the RLBot v5 botpack's submodule points at (RLBot/botpack `master`, tree `2a433ab`).

## 1. The v5 botpack's licence policy

- **Where it lives:** RLBot/botpack `README.md` (the "Submission" requirements and the "Licensing" section) and the pack's
  `LICENSE`. https://github.com/RLBot/botpack. The wiki repeats it: https://wiki.rlbot.org/v5/community/rlbot-pack/
- **Introduced:** commit `8e63268febfc4f422abbf79abb2eab57e108b961`, 2026-02-18, "Add submission instructions and LICENSE"
  (PR #9, merged as `c22528b`, approved by VirxEC). Its second commit `1e3aad9500ba02295a0ddf343e8f3f7e52d7bc3d` (same day)
  renamed the heading "License" to "Licensing". The licence lines haven't changed since then. The README blob now is
  `17c95fa` (last edited by `9aaf94cb955cc366d0de40cf0d1cf224493427a4`, 2026-04-27, which changed only the skill limit).
- **The submission requirement, verbatim:**
  > **License (optional)**: Add a LICENSE file for your bot. The license must allow this bot pack to use the code and
  > distribute the submission. If you do not include a LICENSE, the bot pack defaults to the MIT license.
- **The Licensing section, verbatim:**
  > The submodules in this repository are under the MIT license (see LICENSE), unless the individual submodules specify
  > otherwise. Moreover, the owner of each submodule repository is allowed to change their license at any time as long as
  > the new license still allows the bot pack to use the code and distribute the submission.
  >
  > The owner of each submodule repository can request that their repository is removed as a submodule at any time.
- **The wiki's wording**, added in RLBot/wiki commit `1bfb421fbbe5612d9ee56400b18167084628e6e2` (2026-06-02, VirxEC),
  `docs/v5/community/rlbot-pack.md`:
  > By default, submodules in the botpack fall under the MIT license. If your bot's repository includes its own `LICENSE`
  > file, that license takes precedence — as long as it still allows the botpack to use and distribute your code.
- **The pack's own LICENSE** (blob `f9f2bf2`, from `8e63268`) is MIT, "Copyright (c) 2026 RLBot Community". **It is truncated:**
  the file ends mid-sentence at "ARISING FROM, OUT OF OR IN", without "CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  DEALINGS IN THE SOFTWARE." (996 bytes).
- **Scope and caveats:**
  - **Bots are git submodules:** each bot's code lives in its author's own repo, and the pack only points at it. The
    "default" is a statement in RLBot's README, not a licence file in the bot's repo. GitHub ToS D.6 doesn't apply, since the
    content isn't added to the pack's repo.
  - **A bot's own LICENSE file overrides the default.** The pack only requires that a bot's licence allows the pack itself to
    use and distribute the bot. So a non-commercial or copyleft bot is allowed in (bowie-knife-99, NectoFamily, ChadGPT).
  - **No agreement mechanism:** there's no PR template or CONTRIBUTING file; `.github/` holds workflows only. PR #9 had no
    discussion beyond the two maintainers. Authors "agree" only by opening a submodule PR after 2026-02-18.
  - **Bots added before 2026-02-18** never saw the policy: KickoffOnly and Beast (2025-01), Element (2025-01-19),
    zero-g-script (2025-04), mirror-bot (2025-11), NectoFamily (2025-11-22) and Phoenix CS (2026-02-17).
  - **Bots added on the author's behalf** (Element and NectoFamily by VirxEC; Noob Black and Party Cannon by NicEastvillage;
    TensorBot by its v5 converter): the default rests on the submitter, not the author.
  - **The skill limit:** submitted bots must be no stronger than Nexto ("If your bot gets 42 goals before Nexto gets 28 in
    any soccar mode (1s, 2s, 3s), then it is too good"; `9aaf94c`). Before 2026-03-31 the limit was "platinum rank or lower
    (equal to Element or lower)" (`8e63268` to `f6a50a9`).
  - **Closed, unmerged PRs** (not in the pack): Kiri (#26) and Fury 200B (#30, #31).

## 2. Candidates

**Strength sources:**
- **[CG]:** the ChadGPT README's 3v3 rating chart, by ChadGPT's author: 4,321 five-minute 3v3 games, ratings ChadGPT 1578,
  Nexto 1512 (fixed), Wisp 1109, Necto 736, Immortal −11, Element −36, Willo −189, TensorBot −1157.
  https://github.com/thecosmicskye/ChadGPT
- **[PR n]:** the submitter's text in RLBot/botpack PR n.

**Size:** the bytes are from the GitHub tree API at the pinned commit.

| Bot | Repo (pinned) | Licence basis (commit, date) | ML / scripted, language | Strength (source) | Modes | Weights | Porting notes |
|---|---|---|---|---|---|---|---|
| **Wisp v2-75B** (Eastvillage) | github.com/NicEastvillage/RLBot-Wisp-v2-py @`58d4ab18` | **Explicit MIT file**, "Copyright © 2026 Nicolaj 'Eastvillage' Jensen", added in `58d4ab18fd0c92529b5ae6582ecf1713a6b1887a` (2026-05-10). The README adds "MIT License with the following exception: This software and its derivatives may not be used to cheat or in other ways break Rocket League's terms of service." Trained with GigaLearnCPP-Leak (ZealanL; no LICENSE file, README: "formally publishing this specific version for anyone to use"); the training tool doesn't ship. The repo also ships RocketSim `collision_meshes/soccar/*.cmf` (game-derived; not needed). No Necto/Nexto weights or code. | ML (PPO, GigaLearn C++), Python inference (TorchScript) | Author: "equal to Nexto"; 1v1 vs Nexto 27–29, 2v2 vs Nexto 21–28 [PR 15]. [CG] 3v3: 1109, about 400 below Nexto and 373 above Necto. The earlier v2-23B: 1v1 vs Nexto 10–28, vs Element 25–10 [PR 13]. | 1v1, 2v2, 3v3 (obs padded to 3+3 cars) | `POLICY.lt` 7,689,613 B + `SHARED_HEAD.lt` 5,995,907 B, TorchScript MLP (Linear/LayerNorm/ReLU); ≈ 3.4M params (estimate from bytes) | **Model:** plain MLP, so ONNX is trivial (rebuild nn.Sequential from the state dict, as its own `model.py` does). **Action:** the same 90-row table as Nexto's (`action_parser.py`), mirrored for x, plus **action masks** (ground/air, boost=0, has_flip_or_jump/turtled): our lookup-v1 plus a mask, about 40 lines. **Obs: new builder**, about 432 floats by my count (unverified): ball + goal deltas, kickoff flag, **ball prediction** at ticks 22/66/198/594, 34 pads as 1/(1+timer), the 5 nearest pads, the previous action, wall distances, the landing normal from an arena SDF, score diff, turn radius, ball_touched_step, handbrake value, and 51 per car (local frames, the dodge-relative frame, goal-post test, ETA, demo timer); teammates/opponents shuffled. Python inference about 78 KB (≈ 2,000 lines); TS port about 700–900 lines plus **an engine ball-prediction export** (600 ticks, ball-only). Its RocketSim adapter maps to our engine's car state. Tick skip 8, action delay 7. No scripted kickoff. |
| **Willo 24k** (Eastvillage) | github.com/NicEastvillage/RLBot-Willo-24k @`342c8976` | **Explicit MIT file** (same text), added in `342c8976d1e7768a7c3778bcbc84e5344edcd858` (2026-08-22); the README has the same no-cheating exception. Trained with GigaLearn, using "Wisp's rewards". | ML (GigaLearn), Python inference | [CG] 3v3: −189 (below Element −36). Author: "Best in 3v3", "positioning and possession". | Mainly 3v3; the obs has fixed slots for 2 teammates + 3 opponents, so it runs in any size | `POLICY.lt` 107,871 B TorchScript, "24k parameters" (README); no shared head | Shares Wisp's backend (the same masked action parser, ETA, SDF, ball prediction). **Its obs builder differs:** 9.5 KB, players sorted by ETA into fixed slots. Once Wisp's infrastructure exists, it adds about 300 lines TS. Negligible CPU. |
| **Element** (Rangler; v5 port by VirxEC) | github.com/VirxEC/Elementv5 @`fd33e506` | **Pack default only:** no LICENSE in Elementv5, and it was added 2025-01-19 by VirxEC, before the policy. The v4 copy sits in RLBot/RLBotPack (root MIT, "Copyright (c) 2019 RLBot"), added by lucas-emery (RLGym), not by Rangler. The v4 bot.cfg links github.com/RLGym/RLGymExampleBot (MIT, "Copyright (c) 2021 RLGym"). No Necto code. | ML (RLGym PPO), Python/PyTorch | The pack README until 2026-03-31: "platinum rank … (equal to Element or lower)" (`8e63268`). Lost 10–25 to Wisp v2-23B [PR 13]. [CG] 3v3: −36. The RLBot FAQ ranked it S-tier (from notes/bots-ml.md). | 1v1-trained; in team games it picks the matching opponent and ignores the rest | `src/model.p` 1,189,553 B, a **raw pickle** state dict (restricted unpickler); MLP 107→256×5, heads 5×3 + 3×2 | **Easiest ML port.** Obs: a flat 107 (ball, previous action, 34 pad flags, self 25, opponent 25+6), about 80 lines TS. Action: our multidiscrete-v1 fits (5 heads of −1/0/1, 3 of 0/1; yaw zeroed when jumping). Tick skip 8, applied at 7. **New kickoff:** a closed-loop speedflip state machine (`speedflip.py`, about 60 lines). Tiny CPU. Source about 14 KB. |
| **Beast from the East** (Eastvillage) | github.com/NicEastvillage/RLBot-Beast @`bc22b3cc` | **Explicit MIT file**, "Copyright (c) 2018 " (no holder named), from the RLBot template's initial commit `31846acc32047b3fde1d70300ceae9443f0ec8ef` (2018-04-15, tarehart), kept in the author's repo. Added to the pack 2025-01 (before the policy) and re-pointed upstream 2025-06-29. | Scripted (utility system), Python | Author: "can easily beat one Psyonix AllStar"; RLBot Wintertide 2019: 4th in 1v1; Tiny Tournament: 2nd (README). | 1v1 ("Designed for 1v1 soccer") | none | About 96 KB Python (≈ 2,700 lines incl. a 12 KB vec lib); TS port about 2,000 lines. Needs **RLBot-style ball prediction** (`bot.ball_prediction`); rendering can be dropped. Fits our BotBrain directly (no ONNX). |
| **Phoenix CS** (Eastvillage) | github.com/NicEastvillage/RLBotPhoenixCS @`02537399` | **Pack default only:** no LICENSE file. Added 2026-02-17 by VirxEC, one day before the policy; the author (NicEastvillage) wrote the policy. Built on RedUtils (v4 repo ItsCodeRed/RedUtils has **no LICENSE**; RedUtilsV5 is MIT "Copyright (c) 2025 RLBot"). Credits GoslingUtils, VirxERLU (aerial code basis) and BotimusPrime. | Scripted, C# | No published result found | 1v1, 2v2, 3v3 (bot.toml) | none | About 270 KB C# (≈ 7,000 lines; RedUtils about 230 KB). Needs ball prediction, field geometry, aerial and shot planning. A big port. |
| **Party Cannon V@** (CrabbyCrab101) | github.com/NicEastvillage/PartyCannon @`ea84e432` | MIT file "Copyright (c) 2025 RLBot", **from the RedUtilsV5 template** (`17b9caa56b6748e30969df70b31e71be6f16be93`, 2025-09-15, ItsCodeRed). PR #17: "made by CrabbyCrab101 … adding it on their behalf. Its code was lost, but FlamingFury and I have recovered it by decompiling the binary". So **the author's licence is unclear.** | Scripted, C# (RedUtilsV5) | "on par with King" [PR 17]; King won the RLBot Championship 2023 and 2024 hardcoded brackets (rlbot.org/tournament) | 1v1, teamplay | none | About 190 KB C# (≈ 5,000 lines). Same needs as Phoenix. |
| **Noob Black** (Scumclass) | github.com/NicEastvillage/Noob-Black-425 @`9c8a02b5` | MIT file "Copyright (c) 2025 RLBot" (template), **added by NicEastvillage** in `96f10c560e3c8fc17194ff9ce525ae1e72e8fb72` (2026-05-15) "on Scumclass' behalf". The bot.toml's source link (github.com/rocketeeroof/Noob-Black-V5) is 404. The README: "made with code from the black market". | Scripted, Python | "best in 3s where it is around Bumblebee level" [PR 16] | 3v3 focus (teamplay) | none | About 81 KB Python (≈ 2,000 lines, mostly one 60 KB `bot.py`). Uses RLBot ball prediction. Provenance unclear. |
| **TensorBot** (Soren; v5 by HappyBavarian07) | github.com/HappyBavarian07/TensorBot-v5 @`31f179ed` | **Pack default only.** No LICENSE in the v5 repo or upstream (github.com/DanielDowns/ArtificialIntelligence). Submitted 2026-03-17 (PR #10) by the converter, not the original author. Weights trained by behavioural cloning of **another author's bot (Diablo)**. | ML (imitation), Python/TorchScript | [CG] 3v3: −1157 (weakest listed) | 1v1 | `blueTorchModel.pt` 14,124,634 B + `orangeTorchModel.pt` 14,124,998 B, TorchScript | Obs of 24 floats; 4 output heads; a scripted kickoff. Easy, but weak and unclear. **Not recommended.** |
| **Lucy** (Enkhai) | github.com/Enkhai/Lucy @`master` (`6af55d9` tree) | **Explicit MIT file**, but its text is the RLGymExampleBot template's: "Copyright (c) 2021 RLGym", in the initial commit `122659b36ef22c8091e1f74e9e1e9d56f9135b17` (2022-04-30). The model architecture lives in github.com/Enkhai/lucy-utils (no LICENSE file; `setup.py` declares `license="MIT"`, author "Will Moschopoulos"). lucy-utils bundles **nexto-model.pt, necto-model*.pt and element.p** for comparison, plus Nexto's lookup table in `actors/nexto.py`. Those aren't in Lucy's runtime path, but lucy-utils must not be shipped. Training used human replay states (`replay-samples/`). | ML (SB3 PPO, Necto-style perceiver), Python/PyTorch | **Unknown for the repo model.** The paper (arXiv 2305.15801) reports wins vs Necto/Nexto **retrained by the authors for 1B steps**, not the released bots. The repo's `src/model_599040000_steps.zip` dates from the initial commit (2022-04-30), a year before the paper. HEAD `agent.py` (`e4bed89`, 2022-07-08) loads a `models_folder/…/model_2000000000_steps.zip` that **isn't in the repo**. | Trained 2v2 self-play (`experiment.py`: agents_per_match 2×2); the obs pads to 1 ball + 6 cars | `src/model_599040000_steps.zip` 10,871,016 B, a stable-baselines3 zip (pickle + `policy.pth`) | Obs: Necto-like entity rows (23 features + 5 stacked previous actions + mask; no pads), close to our entity-perceiver-v1 (a new "lucy" variant). Action: rlgym-tools KBMAction (Apache-2.0), so multidiscrete-v1. The model is a perceiver: our own module from lucy-utils' `perceiver.py`, then ONNX. Medium effort, and the strength is unproven. |
| **Levi** (Hytak/LHolten) | v4 only: github.com/RLBot/RLBotPack/tree/master/RLBotPack/Levi; source github.com/LHolten/Leviathan | **Explicit MIT:** Leviathan LICENSE "Copyright (c) 2018 LHolten@Github Hytak#5125@Discord" (`d1146b25df499ae831d71c7bf6e582b6d11a7374`, 2018-08-08), plus MIT headers in the pack's `.py` files. It also sits under the RLBotPack root MIT. **Third-party pieces:** trained on Rashbot's (Marvin's) play; "Uses hardcoded kickoffs from Derevo (made by Jeroen)" (`kick_off.py`; Derevo's licence not checked). **Not in the v5 pack.** | ML (imitation + some RL), Python/PyTorch | A 2018–19 tournament bot ("the version of Levi that plays in most tournaments"); no rating | 1v1 | `levi.mdl` 8,128 B (API size; a tiny symmetric MLP, about 1.5k params from `torch_model.py`) | Trivial model, so easy ONNX or plain TS. Its own input/output formatters (about 9 KB). Weak; at most an "easy" 1v1 option. |
| bowie-knife-99 (Martico2432) | github.com/Martico2432/bowie-knife-99 @`2cab4995` | **Custom non-commercial licence:** "Custom RLBot Bot License v1.0", `0aa55121b54bd1084d51ea816ce8e7a7a0391487` (2026-06-04). §3: "This Software may only be used for personal, educational, research, and non-commercial purposes…". **Excluded.** | Scripted memebot ("bump"), Python | – | memebot | none | – |
| ChadGPT 3v3 (Cosmic Skye) | github.com/thecosmicskye/ChadGPT @`8eb062b8` | **AGPL-3.0** for "runtime, weights and every file here" (`e739c70dac781e5c87898a66197d5faaa0506542`, 2026-09-29). Copyleft, so a closed client is risky. **Excluded.** | ML (GigaLearn fork), hivemind | [CG]: 1578, 66 above Nexto | 3v3 only (one net drives all three cars) | 160 MB bf16 (`policy.bf16.part0/1` 64,783,120 B each + `shared_head.bf16` 30,542,336 B); 80.3M params | Far too large for a browser. |
| NectoFamily (Rolv; v5 by VirxEC) | github.com/VirxEC/NectoFamily @`e5510350` | Contains Rolv's CC BY-NC-SA 4.0 files (notes/bots-ml.md). **Excluded** (the bots being replaced). | ML | Nexto ≈ GC | 1/2/3 | – | – |
| Swishy (Quax) | github.com/bccessnadev/RLBot-Swishy @`96ebadca` | No root LICENSE; the README says "MIT License with the following exception…" (no-cheating). | ML (GigaLearn), C++ | – | **Hoops only** | `POLICY.lt` 3.0 MB + `SHARED_HEAD.lt` 2.9 MB | Not soccar, so out of scope. |
| mirror-bot (Darxeal) | github.com/Darxeal/mirror-bot @`70fa1170` | Pack default only (no LICENSE). | Scripted memebot (mirrors the opponent) | – | memebot | none | Not a real opponent. |
| KickoffOnly (VirxEC), zero-g-script (swz-git), RLDojo (ecolsen7) | – | KickoffOnly and zero-g: no LICENSE; RLDojo: MIT file | A kickoff-only bot, a zero-gravity script, a training tool | – | – | – | Not match bots. |

## 3. The four notes/bots-ml.md left unchecked

notes/bots-ml.md §3 (line 113): "**Not checked:** Levi, TensorBot, Elementv5 and bowie-knife-99."

| Bot | Licence | In the v5 pack? |
|---|---|---|
| Levi | MIT (LHolten/Leviathan LICENSE, `d1146b2`, 2018-08-08; MIT headers in the RLBotPack v4 files) | **No** (v4 RLBotPack only) |
| TensorBot | None anywhere; the pack default only, via its v5 converter (PR #10, 2026-03-17) | Yes (`Botpack/TensorBot-v5` @`31f179e`) |
| Elementv5 | None; the pack default only (added before the policy); v4 copy under the RLBotPack root MIT | Yes (`Botpack/Elementv5` @`fd33e50`) |
| bowie-knife-99 | Custom non-commercial licence (`0aa5512`, 2026-06-04) | Yes (`Botpack/bowie-knife-99` @`2cab499`), **non-commercial: excluded** |

## 4. Shared work any non-trivial replacement needs

- **Ball prediction in the engine:** RLBot v5 gives bots 720 ball-only slices (6 s at 120 Hz; wiki "Ball path prediction").
  Wisp, Willo, Beast, Phoenix, Party Cannon and Noob Black all use it. Our RocketSim fork can step a ball-only copy of the
  arena. Compute it once per tick and share it between bots.
- **Extra per-car state for the GigaLearn bots:** is_jumping, has_flip_reset, a handbrake value, ball_touched_step, demo
  timers, pad timers and the score difference. Our engine's car state should cover most of it.
- **Reading the weights without running bot code:** all the formats are zip/pickle (TorchScript `.lt`/`.pt`, SB3 `.zip`,
  raw `model.p`). Read them as before, with a restricted unpickler.
