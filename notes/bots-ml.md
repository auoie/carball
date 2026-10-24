# Offline vs-bots: ML bot licensing and port notes (BOT1, 2026-10-17)

Research for a possible scope revision: an **offline single-player "vs bots" mode** only. Online matchmaking stays bot-free
(decision 2026-10-14). The user stopped the research on 2026-10-17. This file keeps what was found; the next step (whether and
how to bring in Nexto's code and model) is the user's. Web research only: nothing was downloaded, no weights were fetched.
Licence readings are research notes, **not legal advice**. Items marked *unverified* weren't confirmed from a primary source.

## 1. Licences

### Necto / Nexto (Rolv-Arild)
- **Rolv-Arild/Necto LICENSE today: CC BY-NC-SA 4.0** (the standard legal code; no copyright line, year or holder; GitHub
  reports "Other / NOASSERTION"). https://raw.githubusercontent.com/Rolv-Arild/Necto/master/LICENSE
- **History** (https://api.github.com/repos/Rolv-Arild/Necto/commits?path=LICENSE):

  | Date | Commit | Licence |
  |---|---|---|
  | 2021-09-26 | `182bfaf` | MIT, "Copyright (c) 2021 RLGym" |
  | 2022-02-05 | `ef7f713` | deleted ("Removed for now") |
  | 2022-02 → 2024-04 | – | none |
  | 2024-04-24 | `dd6ccc6` | CC BY-NC-SA 4.0 |

  Nexto's code was added on 2022-05-20 (`b030656`), after the MIT file was gone, so **Nexto was never under MIT**.
  (A libhunt listing saying GPL-3.0 is wrong.)
- **Nexto weights: `nexto-model.pt`** (TorchScript), 1,852,625 bytes, blob `1eb5de56…`. The same file sits in:
  - RLBot/RLBotPack `RLBotPack/Necto/Nexto/`;
  - Rolv-Arild/Necto `rlbot-support/Nexto/`;
  - VirxEC/NectoFamily `nexto/` (an RLBot v5 port).

  There's no model card, no README note on the weights, no GitHub release and no Hugging Face copy.
- **Folder licence:** RLBotPack PR #323 (2024-04-24, by Rolv, "Add specific license for Necto family", no description) added
  `RLBotPack/Necto/LICENSE` = CC BY-NC-SA 4.0. It covers Necto, Nexto, Nexto_EZ and Nexto_Toxic.
  https://github.com/RLBot/RLBotPack/pull/323
- **Necto v1 weights:** `necto-model.pt`, 734,598 bytes, added by Rolv himself to RLBotPack on 2022-02-25 (PR #155), when the
  whole pack was MIT. That copy is *arguably* MIT under GitHub ToS D.6 ("Whenever you add Content to a repository containing
  notice of a license, you license that Content under the same terms"). The argument is weak for Nexto, which a third party
  uploaded "on behalf of Rolv". **Treat both as CC BY-NC-SA 4.0** unless Rolv confirms otherwise.

### Related repos

| Repo | Licence |
|---|---|
| RLBotPack (root) | MIT, "Copyright (c) 2019 RLBot"; no per-bot licence policy in its README |
| RLBot/botpack (v5) | Defaults to MIT when a bot has no LICENSE; bots must be "grand champion rank or lower (equal to Nexto or lower)" |
| VirxEC/NectoFamily | No licence; contains Rolv's CC files (can't relicense them) |
| Rolv-Arild/EARL-pytorch (Nexto's network code) | **No licence**: don't copy it, write our own module |
| rlgym, rlgym-sim, rlgym-ppo, rlgym-compat | Apache-2.0 |
| RocketSim | MIT, "Copyright (c) 2022 ZealanL" (already forked) |

### What CC BY-NC-SA 4.0 means for a closed web game
Source: https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en
- **Non-commercial only:** "not primarily intended for or directed towards commercial advantage or monetary compensation".
  Ads, paid access or sales need Rolv's written permission.
- **Format conversion is allowed** (§2(a)(4)): "simply making modifications authorized by this Section 2(a)(4) never produces
  Adapted Material", so converting TorchScript to ONNX isn't an adaptation.
- **No extra restrictions** (§2(a)(5)(C)): the weights can't be encrypted or obfuscated, and our terms of service must exempt them.
- **Attribution** (§3(a)(1)): the creator(s), the licence notice, a link to the material, and whether we modified it.
- **ShareAlike** (§3(b)) reaches adaptations only, not the whole game. CC FAQ: "CC licenses do not require the collection or
  the compilation itself to be made available under an SA license". So:
  - a closed game around the unmodified weights is OK;
  - **fine-tuned weights must be BY-NC-SA**;
  - a line-by-line translation of `nexto_obs.py` / `bot.py` is likely an adaptation, and a clean-room rewrite of the feature
    layout arguably isn't (*unverified*; ask Rolv).
- **No patent or trademark rights** (§2(b)(2)).
- CC itself "recommend[s] against using Creative Commons licenses for software", which leaves the code side murky.
- Whether model weights are copyrightable is unsettled; treat the licence as binding. The `.pt` file also embeds serialised
  TorchScript code.

## 2. Author statements after the cheating episode
- Modified Nexto was used to cheat in ranked play, late 2022 to January 2023. Psyonix has "a zero tolerance policy when it
  comes to using bots in online play".
  https://www.gamingonlinux.com/2023/01/rocket-league-is-getting-additional-anti-cheat-functionality/
- **RLGym authors** (Reddit Q&A, quoted by Kotaku 2023-01-12):
  - the cheater "made their own tools to use a bot online and just took Nexto from the public repository";
  - Psyonix asked RLGym "not to publicly release any more bots of this caliber until they get the situation under control".

  https://kotaku.com/rocket-league-machine-learning-cheating-nexto-bot-1849980593
- **RLGym to esports.net:** "We're taking steps to ensure our bots can't be abused in the future".
  https://www.esports.net/news/rocket-league-bot-cheaters/
- **Stronger versions are kept private:** the README calls "Nexto+" "a secret post-training upgrade" that "is not available for
  play". Also reported by Gizmodo/Wired (https://gizmodo.com/rocket-league-ai-nexto-gaming-1850006117) and The Batch
  (https://www.deeplearning.ai/the-batch/gamers-are-using-ai-to-cheat-in-rocket-league).
- **What the authors did not do:**
  - they didn't remove the Nexto weights (RLBotPack has only the two 2022 commits);
  - they didn't change the terms in response: the January 2023 README edits only restructured it, and the 2024-09 edit reads
    "The project is not being worked on anymore";
  - the CC licence (2024-04) came with no stated reason.
- **Community:** the RLBot v5 pack caps submitted bots at Nexto's strength, and RLBot "cannot be used online" (https://rlbot.org/faq/).
- **Not checked:** Discord (needs a login); the Reddit and Wired originals (blocked).
- **Psyonix's position** concerns bots in their own game's online play. Nothing found claims rights over the community bot
  weights. Our only concern is trademarks: keep the game's name out of what ships, as the project already does.

## 3. Alternatives

| Bot | Licence | Weights | Claimed skill | Size | Modes |
|---|---|---|---|---|---|
| **Nexto** | CC BY-NC-SA 4.0 | RLBotPack, 1.85 MB TorchScript | "Approximately Grand Champion 1 level in 1v1, 2v2 and 3v3" | ≈ 444k params (estimate) | 1/2/3v3 |
| Necto v1 | CC BY-NC-SA 4.0 (2022 copy arguably MIT) | RLBotPack, 0.73 MB TorchScript | "Around Diamond level" | ≲ 180k (estimate) | 1/2/3v3 |
| Seer (Neville Walo, ETH thesis) | No licence file; the author added it to the MIT RLBotPack (PR #242), so arguably MIT | RLBotPack/Seer/Seer.pt, 8.07 MB state dict | "roughly in the Platinum I rank" (thesis p. 33) | 2,015,127 params (policy + value) | 1v1 |
| Element (Rangler) | No licence file; added by RLGym's lucas-emery, based on RLGymExampleBot (MIT) | RLBotPack/Element/model.p, 1.19 MB pickled state dict | S-tier (RLBot FAQ) | MLP 107 → 256×5, ≈ 296k | 1v1 |
| **Lucy** (Enkhai) | **Explicit MIT** | `src/model_599040000_steps.zip`, 10.9 MB (stable-baselines3) | The Lucy-SKG paper reports beating its own retrained Necto/Nexto baselines (not the released bots; *unverified* that the repo model is the paper's) | not stated | 2v2 evaluated |
| Immortal | No licence file; author-added to the MIT pack | jit.pt, 5.7 MB | unstated | unknown | unknown |
| ChadGPT | **AGPL-3.0, weights included** | ≈ 161 MB (80.3M params, bf16) | claims above Nexto | huge | 3v3 |
| Ripple (Rolv) | pipeline GPL-3.0 | **not published** | – | – | – |
| Opti (Kaiyotech) | no licence | no weights found | – | – | – |
| rlgym-ppo | Apache-2.0 | no trained example weights | – | – | – |

**Sources:**
- Seer thesis: https://nevillewalo.ch/assets/docs/MA_Neville_Walo_Seer_RLRL.pdf
- Lucy: https://github.com/Enkhai/Lucy, and the paper https://arxiv.org/abs/2305.15801
- ChadGPT: https://github.com/thecosmicskye/ChadGPT
- Ripple: https://github.com/Rolv-Arild/replay-pretraining

**Not checked here; since checked in notes/bots-licences.md (BOTS2, 2026-10-24):** Levi (MIT, LHolten/Leviathan
`d1146b2`; not in the v5 pack), TensorBot (no licence; in the pack), Elementv5 (no licence of its own: the pack's MIT
default alone; in the pack) and bowie-knife-99 (a custom non-commercial licence, `0aa5512`; in the pack, excluded). That
note holds the v5 pack's licence policy and the commercial-safe candidates (Wisp v2 and Willo 24k, explicit MIT files).

## 4. Browser-port notes (Nexto)
Sources: RLBotPack `RLBotPack/Necto/Nexto/{agent,nexto_obs,bot}.py`. The architecture comes from Necto's `training/agent.py`
and EARL-pytorch's `earl_perceiver.py`.

### Model
- TorchScript, `EARLPerceiver(128, 2, 4, 1, query_features=32, key_value_features=24)` + `ControlsPredictorDot(128)`.
  - **Input MLPs:** query 32 → 128 → 128 and entity 24 → 128 → 128 (ReLU).
  - **Two cross-attention blocks:**
    - LayerNorm on the query and on the entities;
    - MultiheadAttention(128, 4) with a key_padding_mask;
    - a residual;
    - LayerNorm + feed-forward 128 → 512 → 128 + a residual.
  - **Head:** the 90×8 action table is embedded by an MLP 8 → 32 → 32 → 32. The player embedding is projected 128 → 32, and
    each action's score is a dot product, giving 90 logits.
- About **444k parameters** (fits the 1.85 MB file). *Inferred; check against the state_dict once the weights are downloaded.*
- **Inputs:** q (1, 1, 32), kv (1, n + 35, 24), mask (1, N).
- **The mask:** in RLBot use it's all zeros. PyTorch adds a float key_padding_mask, so use a bool mask or exact shapes.

### Observation: 24 features per entity
- **Features:**
  - one-hot IS_SELF / IS_MATE / IS_OPP / IS_BALL / IS_BOOST;
  - POS(3), LIN_VEL(3), FW(3), UP(3), ANG_VEL(3);
  - BOOST, DEMO, ON_GROUND, HAS_FLIP.
- **Normalisation:** positions and velocities ÷ 2300, angular velocity ÷ 5.5.
- **Orange team:** x and y negated; mate/opponent flags swapped.
- **Entity order:** all cars, then the ball (pos, vel, angvel), then 34 pads.
  - A pad's BOOST = 0.12 + 0.88·(z > 72), i.e. big vs small.
  - Its DEMO column holds the pad's active flag. There are no pad timers.
- **Relative transform** (entity tokens only):
  - subtract the self position;
  - rotate x/y of pos, vel, fw, up and angvel by θ = atan2(fw.x, fw.y).
- **The query** = the self row (absolute, orange-inverted) + the previous 8-float action.
- **Inputs from RLBot:**
  - has_flip = not double_jumped;
  - on_ground = wheel contact or ≤ 6 ticks since contact;
  - boost / 100;
  - pads from is_active.
  - Source: rlgym-compat `game_state.py`.
- **No ball prediction.**

### Actions
- **Tick skip 8**, so 15 decisions per second.
- **A 90-entry table:**
  - **24 ground rows** from throttle, steer, boost and handbrake, skipping boost = 1 with throttle ≠ 1.
  - **66 air rows** from pitch, yaw, roll, jump and boost, skipping jump with yaw ≠ 0 and the all-zero pitch/roll/jump rows.
    The handbrake is set when jumping with a direction.
- **Choosing:** the default β = 1 takes the argmax (deterministic).
  - Otherwise the logits are scaled by log₃((β + 1)/(1 − β)) and sampled: β = 0.5 samples the bot's own distribution, β = 0 is
    uniform random.
- **Kickoff:** a scripted 168-frame KICKOFF_CONTROLS for the car nearest the ball while ball y = 0. Other cars use β = 0.5 in
  kickoff pauses.
- **Difficulty (Nexto_EZ):** replaces the controls with random ones on (100 − STRENGTH) % of ticks.

### ONNX export and cost
- **ONNX:** cross-attention avoids PyTorch's self-attention fast path.
  - Safest route: our own eager module (EARL has no licence), loaded from `torch.jit.load(...).state_dict()`.
  - Export with fixed N (37 / 39 / 41 for 1v1 / 2v2 / 3v3). *Unverified until tried.*
- **CPU, estimated:** ≈ 4M multiply-adds per decision at 41 entities.
  - onnxruntime-web WASM single-thread: ≈ 0.3–2 ms per decision.
  - 5 bots × 15 Hz: ≈ 2–15 % of one core in a worker.
  - WebGPU isn't worth it at this size.
  - **Alternative:** hand-write the two attention layers in our C++ engine (WASM). That keeps inference deterministic and in-engine.

### Necto v1 and Seer
- **Necto v1:** the same 24-feature tokens; q = 24 + 8.
  - Pad respawn timers ÷ 10 s, and car demo timers.
  - Multi-discrete output (3, 3, 2, 2, 2).
  - `EARLPerceiver(128, 1, 4, 1)`.
- **Seer:** 159 inputs in [−1, 1] (Euler angles, pad flags and timers, demo timer, one-hot previous action).
  - Linear 159 → 256, then LSTM(512), then MLP 512 → 256 → 256 → 128 → 22.
  - 7 masked heads; the LSTM state resets at a round end; tick skip 8.
  - ≈ 2M multiply-adds per step; LSTM exports cleanly.
- **Safety:** `model.p` (Element) and `Seer.pt` are Python pickles. Load them only in an isolated venv, with
  `weights_only=True` where possible.

## Recommendation (for the user's decision)
1. **Nexto is usable only while Carball stays non-commercial.** The conditions:
   - ship the full CC BY-NC-SA 4.0 text next to the unencrypted .onnx;
   - add a credits line, e.g. "Nexto AI weights by Rolv-Arild and the Necto contributors, https://github.com/Rolv-Arild/Necto,
     CC BY-NC-SA 4.0. Converted from TorchScript to ONNX; weights unchanged. No warranty.";
   - no fine-tuning unless the result is released BY-NC-SA;
   - write the observation builder from this spec rather than translating it line by line;
   - exempt the weights from our terms.
2. **Questions for Rolv** (the user would ask; agents contact no one):
   1. Confirm the licence of nexto-model.pt and necto-model.pt.
   2. Is a free browser game OK, and what if it's ever monetised?
   3. Is our own reimplementation of the obs builder and the action table OK?
   4. What attribution wording does he prefer?
   5. Any objection, given the cheating history?
3. **Permissive fallbacks:** Seer (1v1, Platinum I) or Element (1v1). Get a one-line confirmation of the implied MIT from their
   authors first. Lucy is the only explicitly MIT bot with weights in its repo; its strength is unproven.
4. **Long term:** our own bot trained with rlgym-ppo (Apache-2.0) on our RocketSim fork (MIT) gives weights we own outright.

## Port status (2026-10-17, NX1)
Local, git-ignored packages for **Nexto** and **Necto v1** are in `out/bsim/assets_local/bots/packages/`:
- `FORMAT.md` (the main session's bot.json schema plus extensions);
- per bot: ONNX per team size, `bot.json`, `SPEC.md`, `vectors.json`, `LICENSE.txt`.

They were built without executing anything from the bot pack: the archives were read as zips with a restricted unpickler, and
the .py files as text. The networks are our own PyTorch modules, with the parameter counts matching the archives exactly
(Nexto 444,032, Necto 173,964), exported with torch.onnx.export and checked with onnxruntime.

The detailed observation and action spec stays in those git-ignored SPEC files (derived from BY-NC-SA code), not here.
**Equivalence with the original models is unproven:** proving it would mean running the original TorchScript once in a
sandbox, which is the user's decision.

**Equivalence check (2026-10-17, done at the user's direct instruction).** The original nexto-model.pt and necto-model.pt
(sha256 bf5343b5… and 137f9492…, both verified) were each run once with torch.jit.load inside an isolated Docker
container:
- image `carball-nx1-torchverify:2.0.1` (python 3.11-slim, torch 2.0.1+cpu, numpy 1.26.4; network only while building);
- run with `--rm --network none`, 4 GB and no swap, a read-only root, all capabilities dropped and no-new-privileges, uid 1000;
- mounts: the two .pt files read-only, the inputs read-only, one output folder.

The models saw 733 observations per bot (NX1's 133 plus 600 random, over 1v1/2v2/3v3). Our ONNX vs the original:

| Bot | Max abs diff | Max rel diff | Picks agree | Vector-sequence picks agree |
|---|---|---|---|---|
| Nexto | 4.2e-5 | 5e-6 | 733/733 | 33/33 deterministic |
| Necto | 9.5e-6 | 4e-6 | 733/733 (every head) | 37/37 |

Our PyTorch module matches Necto's original exactly (0.0). **This proves the networks only;** the observation builders are
reimplemented from the text and weren't run against the original Python. Results are in packages/<bot>/equivalence.json.
