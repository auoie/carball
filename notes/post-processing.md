# Post-processing in a match: Stadium_P (DFH Stadium), live build 2026-10-06

Static session spec, 2026-10-10, requested by the user (relayed by tmp-6f). Drafted by sub-agent PP1. The static session
re-checked the tone curve in `FUberPostProcessBlendPixelShader02000`: A/B/Z/W in cb0[48], toe in cb0[49], the
1e4-wide step, the 1/2.2 exponent, and no noise or dither term (the noise sample exists only in the grain variants
x x1xx). It also re-derived the sample values (0.18 → 0.4605 → 0.488; white at linear 0.7736).
This covers the RL HDR → display chain at the level needed to build one three.js pass chain.

**Tags**
- [A] package data (decrypted Startup / Engine / Stadium_P / TAGame / GameInfo_Soccar_SF).
- [S] UnrealScript; line numbers refer to the listed dump files.
- [N] native code (live `RocketLeague.exe` VAs, read in the private Ghidra copy `out/bsim/agents/PP1/rl-live`).
- [M] shader bytecode (`GlobalShaderCache-PC-D3D-SM5.bin`; offsets are byte offsets of the DXBC blob in that file).
- [I] inferred.

**Sources**
- Script dumps:
  - TAGame: `out/bsim/work/tagame_live_all.txt` (abbreviated *TA*).
  - ProjectX: `out/bsim/agents/PNT1/projectx_live_all.txt` (*PX*).
  - Engine: `out/bsim/agents/K1/work/live_engine_ubc.txt` (*EN*).
- Shader listings (local only, game-derived): `out/bsim/agents/PP1/gsc/*.txt`, indexed by `gsc_index.py`.
- The GlobalShaderCache is **not** Oodle-compressed (plain `BMSG` container with 1759 DXBC blobs), so no decoder was needed.
- Reference implementation (PP1's own code, values only): `out/bsim/agents/PP1/ref/pp_ref.py`.

---

## Numbered summary

**PP-1 — Chain [A][S]**
- The chain in a match is `PostProcess.Standard_PP` (Startup.upk), and it has two effects:
  - `AmbientOcclusionEffect_1` (SceneDPG World);
  - `UberPostProcessEffect_0` (SceneDPG PostProcess).
- It is the Stadium_P `WorldInfo.WorldPostProcessChain`, and also `Default__Engine.DefaultPostProcessName`.
- What does not change it:
  - Stadium_P and its only sublevel (`stadium_oob_audio_map`) have no PostProcessVolume.
  - The match camera has no CamOverridePostProcess alpha.
  - No TAGame script adds, removes or toggles chains or effects during a match.

**PP-2 — Effective parameters [A][N]**
- Rule: each value comes from the WorldInfo `DefaultPostProcessSettings` only where its `bOverride_*` flag is set. Otherwise the effect's own value applies (Standard_PP, falling back to `Default__UberPostProcessEffect`).
- Key consequence: Stadium_P **turns off** the HighLights, MidTones and Shadows overrides. So the UE3 class defaults apply: SceneHighLights 0.8, SceneMidTones 1.3, SceneShadows (0, 0, −0.003).
- Table in §2.

**PP-3 — Order of the Uber passes [N][M]**
- The order is: half-res copy → DOF gather + blur → half-res composite (DOF / motion blur) → bloom gather → multi-scale bloom → LUT build → full-res blend (DOF composite, bloom add, tonemap, LUT) → optional AA.
- The blend shader is `FUberPostProcessBlendPixelShader02000`. Its digits mean: DOF simple, Tonemapper_Customizable, no grain, no separate translucency, no TAA.

**PP-4 — Tone map [M][N]**
- The curve is a per-channel blend of "Reinhard with a gamma toe": out = sat((1−T)·P + T·B·x/(x+A)).
  - P is `x^(1/2.2)` below Z and `B·x/(x+A)` above Z.
  - A = 0.22, B = 1.0275, Z = 0.255447, T = 0.5, TonemapperScale 1.
- The output is already display-encoded.
- See §4 for the curve and a verification table.

**PP-5 — Colour remap [M][N][A]**
- A computed 16³ LUT (no LUT texture in Stadium) applies, in display space:
  - f(g) = min(1, (1.25·sat(g − shadows))^1.3), with blue shadow −0.003;
  - plus the camera fade/colour-scale term.
- Desaturation is 0, colorize 1, DisplayGamma 2.2 (identity).
- Display white is reached at linear 0.774 (before bloom).

**PP-6 — Output [M][N][I]**
- There is no sRGB curve anywhere.
- The display encoding is the tonemapper's own pow(1/2.2) toe and Reinhard section, followed by the LUT.
- There is no user brightness/gamma option for SDR. DisplayGamma is fixed at 2.2 and only enters as pow(c, 2.2/DisplayGamma) = identity.
- There is no dithering; the output is 8-bit.

**PP-7 — Bloom gather [M][N]**
- Quarter resolution, 4 bilinear taps at (±1.16, ±1.16) half-res texels, read from the half-res DOF composite.
- Soft threshold on the max channel: w = sat((max(r,g,b) − 2)/2), i.e. 0 at 2 and 1 at 4.
- The gather multiplies the tap colour by w; it does not subtract the threshold.

**PP-8 — Bloom pyramid [N]**
- RL-specific BloomType 2: three sizes (small 8, medium 64, large 128, from BlurBloomKernelSize 32 × 0.25 / 2 / 4).
- Normalised weights: 0.0833, 0.25, 0.6667.
- The medium and large layers are blurred on 1/8- and 1/16-res copies, combined, then blurred again with the small kernel.
- Gaussian rule: σ² = r texels², where r = size/4 · (W/1280)², clamped to ≤ 15. Samples outside the view count as black.

**PP-9 — Bloom add [M]**
- C += Bloom · BloomScale·Tint · sat(10·2^(−3·lum(C))). It is added **before** the tone map.
- BloomScale 1, Tint white, ScreenBlendThreshold 10.

**PP-10 — Depth of field (on) [A][N][M]**
- Simple DOF with FocusDistance = InnerRadius = 16384, MaxNear 0, MaxFar 0.6, Falloff 4, MinBlur **0.25**.
- Every arena pixel is therefore 25 % from the soft half-res/DOF layer: about 0.75·S + 0.1875·S_half + 0.0625·blur.
- The sky and the far stands reach 60 %.

**PP-11 — Motion blur (on by default) [A][M]**
- Velocity-based, at half resolution, applied through the same half-res layer.
- MotionBlurAmount 0.25, MaxVelocity 1, FullMotionBlur, rotation threshold 90°, translation threshold 10000.
- The sample tables are native constants that were not decoded. Low priority.

**PP-12 — SSAO (on by default) [A]**
- Angle-based, AO_Low.
- OcclusionScale 4, MinOcclusion 0.375, Radius 12, Power 4, fade-out 4000–4500 uu, Halo 20/0.1/0.04, AffectsLightingOnly.
- Runs in the World DPG before translucency.

**PP-13 — Sun light shafts (on by default) [A][M][I]**
- On the sun DirectionalLight__LC_1: BloomScale 2, BloomThreshold 0.2, ScreenBlendThreshold 1, OcclusionMaskDarkness 0.75, OcclusionDepthRange 200000, RadialBlurPercent 100.
- Scene pass before the post-process chain. The constant mapping is [I].

**PP-14 — Lens flares (on by default) [A]**
- 24 StaticLensFlareSource components (sun glow, spiral rainbow, stadium-light flares), all in SDPG_Foreground.
- They render before the Uber pass, so they are bloomed and tone-mapped.

**PP-15 — Absent in a match [A][S][N]**
- Vignette, film grain (scale 0), colour-grading LUT texture, scene tint/colorize (1), desaturation (0).
- Temporal AA, separate translucency, the image filters (replay only) and the SuperSonic material effect (in an unused chain, never enabled).

**PP-16 — Video options [S][N][A]**
- Every option maps to a `scale set` system setting; see the table in §7.
- The High preset (default) enables everything above.
- Bloom off skips the bloom passes. DOF off zeroes the blur amounts. Motion Blur off selects the non-MB half-res variant.

**PP-17 — Ordering [N][I]**
- The sequence is:
  1. World opaque + lighting;
  2. SSAO;
  3. height fog;
  4. sun shafts;
  5. world translucency/particles (into HDR scene colour);
  6. Foreground DPG (lens flares);
  7. Uber (HDR → LDR);
  8. AA (FXAA/MLAA/SMAA if chosen);
  9. HUD (Scaleform: boost meter, nameplates, scoreboard), not tone-mapped.

**PP-18 — During play [S]**
- Nothing in a live match changes post-process parameters, except camera fades through the LUT's GammaOverlay:
  - a 1 s fade-in from black after loading;
  - a goal-replay fade from black: 0.5 s at the replay's start and end (corrected 2026-10-10; see §9).
- Goal explosions, demolitions, supersonic, kickoff, ball cam and slow-motion: none.

**PP-19 — three.js [I]**
- renderer.toneMapping = NoToneMapping and renderer.outputColorSpace = LinearSRGBColorSpace. Do not use OutputPass.
- The final custom pass writes display values directly. Recipe and GLSL in §10.

**PP-20 — Ships vs game data**
- Everything that ships is scalar parameters and closed-form rules:
  - curve constants, remap params, 16 LUT node values computed from them;
  - threshold, weights, kernel sizes, the Gaussian tap rule, DOF params.
- No texture or LUT asset is needed. The shader dumps stay local.

---

## 1. The chain in a match

**Chain selection**
- [A] Stadium_P `TheWorld.PersistentLevel.WorldInfo_3`: `WorldPostProcessChain = PostProcess.Standard_PP`.
- [A] `Engine.Default__Engine.DefaultPostProcessName = 'PostProcess.Standard_PP'`.
- So the world chain and the engine default are the same chain.
- [S] *EN* 7815 `GameInfo.RestartPlayer`: `LP.RemoveAllPostProcessingChains(); LP.InsertPostProcessingChain(LP.Outer.GetWorldPostProcessChain(), -1, true)`.
- [S] *PX* 16456 `PostProcessManager_X.GetPlayerChain`: `bForceDefaultPostProcessChain ? Engine default : PlayerPostProcess`. Both are Standard_PP.

**PostProcessVolumes [A]**
- None in Stadium_P.
- None in `Stadium_OOB_Audio_Map` (decrypted into `out/bsim/agents/PP1/decrypted/`). It holds only crowd/audio actors.

**Camera overrides [A]**
- `Archetypes.Camera.Camera_Default` (GameInfo_Soccar_SF) and `Default__Camera` / `_X` / `_TA` leave CamOverridePostProcessAlpha at 0.
- Stadium_P's CameraActor_7 is not a match view target.

**Runtime chain changes [S][A]**
- PostProcessManager_X `Start/Stop/ToggleEffectNamed`, `StartChainNamed` and `SetMaterialEffectValue` are not called by any TAGame code. Their names are absent from TAGame.upk's name table.
- `PostProcessManager_Default` (GameInfo_Soccar_SF) has no properties.
- TAGame only uses the manager for the replay viewer (ReplayFX DOF/AA). See §9.

**Effects in Standard_PP, in order [A]**
1. `AmbientOcclusionEffect_1`: SceneDPG World (class default), bUseWorldSettings False.
2. `UberPostProcessEffect_0`: SceneDPG PostProcess, bUseWorldSettings **True**.
   - It contains DOF, motion blur, bloom, tone map, colour remap and AA as sub-passes.
   - There are no separate MaterialEffects, BlurEffects or extra DOF effects.

**Other chains in Startup.upk, not used in a match [A]**
- `Menu_PP` (AO + Uber, desaturation 0.1, grain on).
- `postprocess_fx.PP.Main01_PP` and `Menu_PP` (MaterialEffect_X "SuperSonic" + Uber). Referenced by no other package.
- `PawnSwapping_PP`, `Retro_PP`, `Cubemap_Blur*_PP` (the GrassCube capture, SUR-32), `EngineMaterials.Default*PostProcess`.

## 2. Effective parameters (Stadium_P, Standard_PP, world settings)

**Override rule [N]**
- In the Uber proxy constructor 0x1405a1e00 and the DOF/Bloom proxy constructor 0x14042e5d0, each field takes the world value only when its `bOverride_*` bit is set.
- The bit positions match the PostProcessSettings declaration order:
  - word 0: bits 0–31, EnableBloom … Scene_TonemapperScale;
  - word 1: bit 0 ImageGrainScale, 1 HighLights, 2 MidTones, 3 Shadows, 9 bEnableBloom, 10 bEnableDOF, 11 bEnableMotionBlur, 12 bEnableSceneEffect.
- Effect property offsets (0xf8 SceneShadows … 0x15c BloomSizeScaleLarge) were checked against the declaration order of `UberPostProcessEffect` in Engine.upk.

| Parameter | Value used | Source |
|---|---|---|
| SceneShadows | (0, 0, −0.003) | Effect (Default__UberPostProcessEffect); Stadium sets bOverride_Scene_Shadows **False** [A] |
| SceneHighLights | (0.8, 0.8, 0.8) | Effect default; Stadium override False [A] |
| SceneMidTones | (1.3, 1.3, 1.3) | Effect default; Stadium override False [A] |
| SceneDesaturation | 0 | World (override True by default, 0.0); Standard_PP also 0 [A] |
| SceneColorize | (1, 1, 1) | Effect default (world override False) [A] |
| TonemapperType | Customizable (2) | Standard_PP [A] |
| TonemapperRange | 8.0 | Effect default [A] |
| TonemapperToeFactor | 0.5 | Standard_PP [A] |
| TonemapperScale | 1.0 | Effect default; world override False [A] |
| SceneImageGrainScale | 0.0 (bEnableImageGrain True, but the scale is 0, so no grain variant) | Standard_PP [A] |
| bScaleEffectsWithViewSize | True | Standard_PP [A] |
| BloomWeightSmall / Medium / Large | 0.125 / 0.375 / 1.0, normalised to 0.08333 / 0.25 / 0.66667 | Standard_PP [A]; normalisation in 0x1405a1e00 [N] |
| BloomSizeScaleSmall / Medium / Large | 0.25 (class default) / 2.0 / 4.0, clamped to [0,1] / [0.25,2] / [1,8] | [A][N] |
| Bloom_Scale | 1.0 | World (override True) [A] |
| Bloom_Threshold | **2.0** | Stadium WorldInfo [A] |
| Bloom_Tint | (255, 255, 255), i.e. white | World default [A] |
| Bloom_ScreenBlendThreshold | 10.0 | World default [A] |
| DOF_BlurBloomKernelSize (bloom size base) | **32** | Stadium [A] |
| bEnableDOF | True | Stadium [A] |
| DOF_FocusType | FOCUS_Distance | World default [A] |
| DOF_FocusDistance | 16384 | Stadium [A] |
| DOF_FocusInnerRadius | 16384 | Stadium [A] |
| DOF_FalloffExponent | 4 | World default [A] |
| DOF_BlurKernelSize | 4 | Stadium [A] |
| DOF_MaxNearBlurAmount | 0 | Stadium [A] |
| DOF_MaxFarBlurAmount | 0.6 | Stadium [A] |
| DOF_MinBlurAmount | **0.25** | Effect (Standard_PP); world override is False [A] |
| DepthOfFieldType / Quality | Simple / Low (class defaults) | [A] |
| MotionBlurAmount | 0.25 | Standard_PP [A] |
| MaxVelocity | 1.0 | Class default [A] |
| FullMotionBlur | True | Class default [A] |
| Camera rotation / translation thresholds | 90° / 10000 | Class default; world overrides False [A] |
| MotionBlurSoftEdgeKernelSize | 0 | Class default (selects the plain motion-blur path) [A][N] |
| PostProcessAAType | Off (0) by package; the user's AA option sets it at runtime | [A][S] |
| bEnableHDRTonemapper / SceneHDRTonemapperScale | Unset (HDR output only) | [A] |

## 3. Uber pass structure (one frame)

**Proxy render** — `0x1405be460` (vtable `0x141bdbb00`) [N]

1. **Scene → half res.** `0x1404420a0` → `0x140a6e440` → `FDownsampleScene` [M @1846566].
   - rgb = mean of 4 taps of full-res scene colour (a 2×2 average).
   - a = linear view depth (sky/near sentinel 65504).
2. **DOF gather + blur** (`0x1405c1080`, DOF type Simple).
   - `TDOFGatherPixelShader` [M @2521639], quarter res (FilterDownsampleFactor **4**, `0x140a97130` writes `[+0x144] = 4`; filter buffers are Buffer/4 + 2).
   - Mean of 4 half-res taps at ±0.5 half-res texel (a 2×2 box): c̄, d̄.
   - b = blur(d̄); out = (c̄·b, b) · 0.25.
   - Then a Gaussian blur (§5.4) with r = BlurKernelSize · s / 4 · s = **s²**, where s = ViewWidth/1280.
3. **Half-res composite** `H`.
   - `0x1405a0100` (MB off) or `0x14059ff10` (MB on) → `0x1405c09d0`.
   - Shader `FUberHalfResPixelShader0010` [M @2012837] (DOF), or `…1010` [M @1996073] (DOF + motion blur).
   - Formula in §6. Written to the texture the blend shader binds as LowResPostProcessBuffer.
4. **Bloom.** Only if the system setting Bloom is on (`DAT_142272de8`); otherwise the bloom targets are cleared to 0.
   - `0x1405bf4c0`: gather (`0x140453810` + `0x14042a500`, shader `FBloomGatherPixelShaderNumFPFilterSamplesFALSE` [M @2517830]), then the pyramid (§5).
5. **LUT build.** `0x1404e5250` / `0x1404e6a80`, shader `FLUTBlenderPixelShader<1>` [M @2474899].
   - 256×16 target (16³).
   - Neutral LUT with weight 1, because the LUTBlender list is empty and `ColorGrading_LookupTable` is None.
6. **Full-res blend.** `FUberPostProcessBlendPixelShader02000` [M @2226515], parameters set in `0x1405bfda0`.
   - Variant digits from `0x1405ba040`: DOF_FULLRES_MODE, USE_TONEMAPPERTYPE, USE_IMAGEGRAIN, separate translucency, temporal AA.
   - Selection in `0x1405be460`: DOF type Simple → 0; tonemapper 2; grain 0 (scale 0); `bAllowSeparateTranslucency` False → 0; `bAllowTemporalAA` False → 0.
7. **AA.** If PostProcessAAType ≠ Off: FXAA (`FFXAABlendPixelShader0..5`), MLAA or SMAA, applied to the LDR result.
   - The blend writes luma (0.299, 0.587, 0.114) to alpha for FXAA.

**Full-res blend, exact (linear HDR in, display out) [M]**

Inputs:
- S = full-res scene colour (linear).
- H = half-res layer (bilinear), with UV clamped to HalfResMaskRect.
- Bl = quarter-res bloom texture (bilinear).

```
C1   = mix(4*H.rgb, S, H.a)                       // DOF / motion-blur composite
C1   = clamp(C1, 0, 65503)
lum  = dot(C1, vec3(0.30, 0.59, 0.11))
k    = clamp(ScreenBlendThreshold * exp2(-3*lum), 0, 1)                  // 10 * 2^(-3 lum)
C2   = C1 + 4 * Bl.rgb * (BloomScale * BloomTint.rgb) * k                // the 4x undoes the gather's 0.25 storage
D    = Tonemap(C2)                                                       // per channel, §4, display space
out  = LUT16(D)                                                          // §5.5; out.a = dot(out, (0.299, 0.587, 0.114))
```

## 4. Tone mapping (Tonemapper_Customizable)

**Shader [M] (blend shader, ImageAdjustments2 = cb0[48], ImageAdjustments3 = cb0[49])**

Per channel, with x = C2:

```
R(x) = B * x / |x + A|
G(x) = (W * x)^(1/2.2)
P(x) = G + saturate((x − Z) * 10000) * (R − G)        // gamma toe below Z, Reinhard above
out  = saturate(P + T * (R − P))                       // = saturate((1−T)·P + T·R)
```

**Constants [N]** (`0x1405bfda0`; proxy fields from `0x1405a1e00`)
- s = max(TonemapperScale, 1e-6)
- A = 0.22/s
- B = (Range + A)/Range
- Z = sqrt(A·B/s) − A, i.e. the x where the Reinhard slope equals s
- W = s
- T = clamp(ToeFactor, 0, 1)

**Stadium values:** s = 1, Range = 8, Toe = 0.5, giving **A = 0.22, B = 1.0275, Z = 0.255447, W = 1, T = 0.5**.

**Closed form**
- x ≥ Z: out = 1.0275·x/(x+0.22).
- x < Z: out = 0.5·x^(1/2.2) + 0.51375·x/(x+0.22).
- There is a small jump at Z: 0.545 → 0.552. It is real (`saturate((x−Z)·1e4)` makes it a 1e-4-wide step).
- Saturation happens at x = 8 (B·8/8.22 = 1). The output is display-encoded (gamma-like) and feeds the LUT directly.

**HDR scene colour scale**
- The scene colour is true linear; there is no pre-scale. TonemapperScale = 1, and the blend shader reads scene colour unscaled.
- The 4× factors only undo the ×0.25 storage of the half-res and bloom buffers.
- Scene colour is clamped to 65503 (FP16 range [I]).

**Tone map alone, and the full display mapping for neutral input (no bloom, no DOF)**

The full display value is Tonemap followed by the LUT (§5.5).

| linear x | Tonemap(x) | display R,G (float LUT) | display B | display (8-bit LUT) | sRGB(x), for comparison |
|---|---|---|---|---|---|
| 0 | 0 | 0 | 0.0007 | 0 | 0 |
| 0.001 | 0.0240 | 0.0142 | 0.0155 | 0.0141 | 0.0129 |
| 0.005 | 0.0564 | 0.0335 | 0.0355 | 0.0332 | 0.0610 |
| 0.01 | 0.0840 | 0.0546 | 0.0570 | 0.0545 | 0.0999 |
| 0.02 | 0.1273 | 0.0921 | 0.0949 | 0.0927 | 0.1517 |
| 0.05 | 0.2233 | 0.1910 | 0.1944 | 0.1907 | 0.2478 |
| 0.10 | 0.3361 | 0.3240 | 0.3278 | 0.3252 | 0.3492 |
| 0.18 | 0.4605 | 0.4879 | 0.4921 | 0.4897 | 0.4614 |
| 0.25 | 0.5395 | 0.5994 | 0.6037 | 0.6009 | 0.5371 |
| 0.26 | 0.5566 | 0.6243 | 0.6287 | 0.6250 | 0.5469 |
| 0.40 | 0.6629 | 0.7833 | 0.7879 | 0.7825 | 0.6652 |
| 0.50 | 0.7135 | 0.8622 | 0.8669 | 0.8627 | 0.7354 |
| 0.70 | 0.7818 | 0.9708 | 0.9756 | 0.9711 | 0.8543 |
| 0.774 | 0.8001 | 1.0 | 1.0 | 1.0 | 0.8932 |
| 1 | 0.8422 | 1 | 1 | 1 | 1 |
| 2 | 0.9257 | 1 | 1 | 1 | 1 |
| 4 | 0.9739 | 1 | 1 | 1 | 1 |
| 8 | 1.0000 | 1 | 1 | 1 | 1 |

**Sample colours (linear → display, 0–255)**

| Colour | Linear | Display |
|---|---|---|
| Grey | 0.18 | (124, 124, 125) |
| Orange | (1, 0.25, 0.02) | (255, 153, 24) |
| Blue | (0.02, 0.2, 1) | (23, 133, 255) |

**Other tonemapper types (not used, for completeness) [M]**
- Type 0 (Off): out = min(x^(1/2.2), 1).
- Type 1 (Filmic): out = sat(x/(x + A)·B), with the same ImageAdjustments2.

## 5. Bloom

### 5.1 Gather (threshold) [M][N]

- **Target and source:** RT 2 (quarter res, FilterBuffer), drawn from H (the half-res DOF/motion-blur composite).
- **GatherParams.x = 4.0** decompresses H, since H stores colour/4 (`0x1405bf4c0` passes 4.0 via `0x140453810`).
- **Tap offsets** (`0x140453810`): with FP filtering support (`DAT_142271020` = 1 on D3D11, set in `0x140da3e30`), the 4 taps are at (±1.16, ±1.16) half-res texels from the quarter-res pixel centre. The code computes them as −0.5t ∓ 0.66t and −0.5t + 1.66t. Without FP filtering they are at ±0.5.

```
for each of 4 bilinear taps:  c = 4*H(tap).rgb
                               w = saturate((max(c.r, c.g, c.b) − Threshold) * 0.5)    // Threshold = 2.0
                               acc += c * w
out.rgb = acc * BloomScale * 0.25 * 0.25 ;  out.a = 0        // = mean(c·w)·BloomScale / 4  (stored ×0.25)
```

- The threshold is a **soft knee on the max channel**: multiply, no subtraction. w = 0 for max ≤ 2, rising linearly to 1 at max = 4.
- BloomScale is applied here **and** again in the blend (it ends up squared; 1 in Stadium).

### 5.2 Pyramid (BloomType 2) [N] (`0x1405bf4c0`)

**Inputs**
- s = ViewWidth/1280 (bScaleEffectsWithViewSize, `0x1405be460`: `view.SizeX / 1280.0`).
- Sizes: Sm = 32·0.25 = 8, Md = 32·2 = 64, Lg = 32·4 = 128.
- Weights: ws = 0.08333, wm = 1 − ws − wl = 0.25, wl = 0.66667.
- BloomType is 2 because wl > 0.01. The console variable `BloomType` can override it.

**Steps**
1. `G` = gather (quarter res, RT2).
2. `M0` = 2×2 box downsample of G → 1/8 res (RT3). Blur with r_m = (Md − Sm)·s·0.5 / 4 · s = **7 s²**. In split-screen (more than one view) this blur is skipped.
3. `L0` = 2×2 box downsample of blurred M0 → 1/16 res (RT1). Blur with r_l = (Lg − Sm)·s·0.25 / 4 · s = **7.5 s²**.
4. Combine into RT5: `ws·G + wm·up2(M) + wl·up4(L)`, bilinear upsampling, additive draws (`0x140a6c470`).
5. Final blur of RT5 with r_s = Sm·s/4·s = **2 s²**. The output goes to RT2 (FilterColor1), which the blend samples.

**Other bloom types:** type 1 uses only G and M; type 0 is a single blur of size Md.

### 5.3 Radii at common widths [N]

r is used as the Gaussian **variance** in texels² of the buffer being blurred (§5.4), clamped to 15.

| Width | s | r_small (1/4) | r_medium (1/8) | r_large (1/16) | r_DOF (1/4) |
|---|---|---|---|---|---|
| 1280 | 1 | 2 | 7 | 7.5 | 1 |
| 1920 | 1.5 | 4.5 | 15.75 → 15 | 16.9 → 15 | 2.25 |
| 2560 | 2 | 8 | 15 | 15 | 4 |
| 3840 | 3 | 15 | 15 | 15 | 9 |

### 5.4 Gaussian rule, exact [N]

`0x140a71120`: blur driver. `0x140a6c840`: weights. `TFilterPixelShader<N>` [M @1812174…]: taps.

```
r   = (KernelSize / 4) * (ViewWidth / 1280)          // caller passes KernelSize already multiplied by s: so r ∝ s²
if (r <= 0.1) skip
n   = min(MaxFilterBlurSampleCount, 16) − 1          // = 15 (BaseSystemSettings.ini MaxFilterBlurSampleCount=16)
r   = clamp(r, 1e-5, n)
K   = min( −( rint(−0.5 − 2r) >> 1 ), n )            // rint = round-half-even (cvtss2si); >> = arithmetic shift
for i = −K; i <= K; i += 2:                          // bilinear pairs (i, i+1)
    w0 = exp(−i²/(2r));  w1 = (i == K) ? 0 : exp(−(i+1)²/(2r))
    offset_j = i + w1/(w0+w1);  weight_j = w0 + w1
normalise weights to sum 1
```

- **Passes:** if fewer than 3 taps, one 2D pass with N² taps (product weights). Otherwise two separable passes (X, then Y).
- **Offsets** are in texels of the buffer being blurred.
- **Edges:** each tap whose UV falls outside the valid view rectangle contributes **0**, and the weights are not renormalised. This darkens bloom and DOF near screen borders.
- **Tap tables** (offset/weight lists for 1280/1920/2560): `out/bsim/agents/PP1/ref/taps.txt`. Example, 1920 small (r = 4.5, K = 5):
  - offsets −4.2689, −2.3646, −0.4723, 1.4174, 3.3148, 5.0
  - weights 0.04387, 0.19147, 0.35954, 0.29145, 0.10187, 0.01180
- **Downsamples** (`0x140a6e440`, factor 2) are 2×2 box filters (4 taps at texel centres, weight 1/4 each).
- **Tint:** `DAT_142260520..2c` is (1, 1, 1, 1).

### 5.5 Blend

See §3: `C2 = C1 + 4·Bl·BloomScale·Tint·sat(10·2^(−3·lum(C1)))`.
- Added in linear HDR, **before** the tone map.
- With lum ≤ 1.107 the screen-blend factor is 1. Above that it falls off: lum 2 → 0.156, lum 4 → 0.0098.

### 5.6 Colour remap LUT [M][N]

**Build** (`FLUTBlenderPixelShader<1>`; parameters from `0x1404e6310` and `0x1404e65f0`)
- The grid value g ∈ {0, 1/15, …, 1} per channel, in display space.

```
c = saturate(g − SceneShadows)            // shadows (0,0,−0.003): blue = saturate(g + 0.003)
c = c * (1/SceneHighLights)               // ×1.25, no clamp
c = pow(max(c,1e−8), SceneMidTones)       // ^1.3
c = c*(1−Desat) + dot(c, Desat*(0.30,0.59,0.11))      // Desat 0
c = c * ((1−FadeA)*ColorScale) + FadeA*FadeColor.rgb  // camera fade / colour scale (identity in play)
c = c * SceneColorize                     // (1,1,1)
LUTvalue = pow(max(c,1e−8), (1/DisplayGamma)*2.2)    // DisplayGamma 2.2, so identity
```

**Lookup** (blend shader)
- Standard 256×16 lookup: slice = floor(b·14.9999); u = slice/16 + r·15/256 + 0.5/256; v = g·15/16 + 0.5/16; lerp between slices.
- The LUT is per-channel separable (Desat = 0, Colorize = 1), so the trilinear lookup equals **per-channel piecewise-linear interpolation** of f over the 16 nodes. Checked numerically: error < 3e-15.

**Node values f(i/15), i = 0…15**
- R and G: 0, 0.03954, 0.09737, 0.16494, 0.23974, 0.32042, 0.40613, 0.49624, 0.59031, 0.68799, 0.78898, 0.89305, 1, 1, 1, 1.
- B: 0.0007, 0.04187, 0.10022, 0.16816, 0.24325, 0.32418, 0.41009, 0.50039, 0.59463, 0.69246, 0.79360, 0.89780, 1, 1, 1, 1.
- Nodes above 0.8 are > 1 before storage. Clipping at the LUT (8-bit target) and at the back buffer are not identical for blue: node 12 is 1.00488, which changes blue by at most 0.0047 for display values 0.733–0.8 (linear 0.548–0.774). Use the clipped nodes (what an 8-bit LUT stores; open question 4 closed 2026-10-10 by accepting them). The float-LUT columns in §4 are for reference only.
- **Fades:** the camera fade multiplies the **unclipped** LUT value by (1 − FadeA); clipping happens at storage. Fading a clipped value darkens highlights too much (corrected 2026-10-10).

**Analytic shortcut**
- out = min(1, (1.25·D)^1.3), with blue (1.25·min(D + 0.003, 1))^1.3.
- It differs from the 16-node interpolation by at most 0.0038 (≈ 1/255). An 8-bit LUT differs from a float one by at most 0.0046.

## 6. Depth of field and the half-res layer (DOF on)

**Blur amount** [M] (identical in the gather and the half-res shader)
- Inputs: d = linear view depth; F = FocusDistance (16384); R = InnerRadius (16384); E = FalloffExponent (4).
- `b(d) = max( min( saturate(|d−F|/R)^E , d<F ? MaxNear : MaxFar ), MinBlur )`, with MaxNear 0, MaxFar 0.6, MinBlur 0.25.

**Constants [N]**
- `PackedParameters` = (F, 1/R, E, sat(MinBlur)) and `MinMaxBlurClamp` = (min(MaxNear,1), min(MaxFar,1), 1/BufX, 1/BufY). Set in `0x140456c20`.
- F and R come from the view focus point (`0x14043b7b0`, FOCUS_Distance: F = 16384, R = 16384).
- The setting DepthOfField off forces MaxNear = MinBlur = MaxFar = 0 (`0x14043cdd0`), giving b ≡ 0.

**Resulting blur amounts**
- In the arena (d < 16384): b = 0.25 everywhere.
- Beyond: b rises above 0.25 for d > 27970 and caps at 0.6 for d > 30800. This covers the sky and the far stands.

**Half-res composite (`FUberHalfResPixelShader0010`) [M]**
- Inputs: S_h = half-res scene; D = blurred quarter-res DOF layer (bilinear); w = 1 − b(d_h).
```
H.rgb = 0.25 * (S_h*w + 4*D.rgb) / (4*D.a + w);   H.a = w
```

**Effective result for uniform b = 0.25 (the whole arena)**
- C1 = mix(4H, S, 0.75) ≈ **0.75·S + 0.1875·S_half + 0.0625·Gauss(S_quarter)**, with Gauss variance s² quarter-texels² (≈ 6 px σ at 1920).
- So 25 % of every pixel is a lower-resolution, slightly blurred copy: a visible softening and glow. With DOF off this term disappears.

**Motion blur variant (`…1010`) [M], partly decoded**
- Velocity source:
  - velocity buffer for moving objects;
  - camera reprojection (previous view-projection, cb20–23) for static pixels when FullMotionBlur is on.
- Velocity clamped to length 1 (MaxVelocity).
- 4 samples along the velocity with weights from native tables (cb27–35 static, cb37–45 dynamic), rejected by velocity similarity: weight·max(1 − 10·|Δv|², 0).
- Blended in by min(|v|·cb15, 1)·w; the full-res weight drops to w·(1 − min(|v|·cb15, 1)·w).
- MotionBlurAmount 0.25. The values of cb15, cb25 and cb27–45 are set natively and were **not decoded**.

## 7. Video settings (High is the default preset)

**Presets** [S] (*TA* 55234 `SetRenderDetailValue`)
- **High:** everything on.
- **Medium:** AO, DOF, Bloom, LightShafts, LensFlares and MotionBlur off; DynamicShadows on.
- **Low:** everything off, plus TexturesMedium, DetailMode 0, ParticleLODBias 1.

Every option is a console `scale set <SystemSetting>` (*TA* 55193–55380). The system-settings table at `.data` 0x1422719f8 maps names to globals [N]. The defaults come from the snapshot's `Engine/Config/BaseSystemSettings.ini` and `TAGame/Config/DefaultSystemSettings.ini` [A].

| UI option | System setting (global) | Effect on the chain | Default |
|---|---|---|---|
| Render Quality | `ScreenPercentage` 100 / 85 / 70 / 55 | Scene rendered at that % and upscaled (UpscaleScreenPercentage=True). s uses the view width [I] | 100 |
| Render Detail | Preset (writes the options below) | — | High |
| Anti-Aliasing | Uber `PostProcessAAType` (via PostProcessManager_TA.SetAAType) | Off / FXAA Low, Med, High (2/4/6) / MLAA (7) / SMAA (8), applied after the blend | Off (list default 0) [S] |
| High Quality Shaders | `bAllowHighQualityMaterials` (0x142272e68) | Material HQ/LQ permutations, not post-process | True |
| Ambient Occlusion | `AmbientOcclusion` (0x142272de4) | SSAO effect on/off | True |
| Depth of Field | `DepthOfField` (0x142272de0) | Off zeroes MaxNear/MinBlur/MaxFar, so H.a = 1 (no softening) | True |
| Bloom | `Bloom` (0x142272de8) | Off skips §5 and clears the bloom targets | True |
| Light Shafts | `bAllowLightShafts` (0x142272dec); also saved in VideoSave.bShowLightShafts | Sun shafts | True |
| Lens Flares | `LensFlares` (0x142272e00) | 24 foreground flare components | True |
| Dynamic Shadows | `DynamicShadows` (0x142272e84) | Not post-process | True |
| Motion Blur | `MotionBlur` (0x142272dd8) | Uber proxy MB flag selects the …1010 half-res variant | True |
| Weather Effects | VideoSave.bShowWeatherFX | Not post-process | False (unset) |
| Effect Intensity | `FullEffectIntensity` (0x142272e88) | Material constant and component visibility, not post-process | Default |
| World / Texture / Particle Detail | DetailMode, texture bucket, ParticleLODBias | Not post-process | High |
| HDR Paper White / Contrast / Peak | `HDR Set HDRGamma …` | HDR-output reconstruction pass (`0x14048f7e0`: MaxNits, ReconstructedColorSaturation, DisplayGamma, SDRSceneColorTexture), HDR displays only | 250 / 1.75 / 1250 |

**Fixed values relevant to the chain [A]**

| Setting | Value |
|---|---|
| MaxFilterBlurSampleCount | 16 |
| bAllowSeparateTranslucency | False |
| bAllowTemporalAA | False |
| bAllowPostprocessMLAA | False |
| FloatingPointRenderTargets | True |
| MaxMultiSamples | 1 |

**Caveat:** the brief says config file IO is disabled. The two ini files nevertheless exist in the snapshot; whether the exe reads them is unverified. MaxFilterBlurSampleCount must be ≥ 2 at runtime for the bloom to work at all.

## 8. Ordering

**Order** [N][I] (standard UE3 FSceneRenderer order, consistent with the DPGs found)
1. World DPG opaque base pass + lighting.
2. SSAO (World-DPG effect, AffectsLightingOnly).
3. Height fog (SUR-24).
4. Sun light shafts (scene pass, additive into scene colour).
5. World translucency: particles, glass, cage, goal FX, decals. Composited into the HDR scene colour because separate translucency is off.
6. Foreground DPG: all 24 Stadium lens flares are SDPG_Foreground [A].
7. PostProcess DPG: the Uber chain (§3) turns HDR into an LDR display image.
8. AA.
9. Canvas/Scaleform HUD, not tone-mapped and not bloomed.

**What this means**
- Particles, fog, shafts and flares are all bloomed, DOF-softened and tone-mapped.
- No 3D HUD primitives exist in a match. The boost meter, nameplates and scoreboard are Scaleform, drawn after post-processing.

**Fog (2026-10-10, FOG1; notes/arena-surroundings.md FOG-10/12):** the height-fog pass is separate and always runs; it is never folded into the light shafts in this build (FUN_140a109c0 returns 0). It applies to DPG World only (lens flares in the Foreground DPG are not fogged). Translucency and particles fog per vertex in their own base pass. The shafts-vs-fog order stays [I].

## 9. Gameplay-driven changes

**In a live match, the chain and its parameters are constant [S][A]**
- Goal explosions: their packages have no post-process tracks and no SeqAct_SetPostProcess. They interact only through HDR content (bloom above 2).
- Demolition, supersonic, kickoff countdown and ball cam: no post-process code.
- The SuperSonic MaterialEffect_X is unused:
  - it lives only in `postprocess_fx.PP.Main01_PP` and `Menu_PP`, with bShowInGame False;
  - nothing calls StartEffectNamed for it.
- `InterpTrackPostProcess_TA` and `SeqAct_SetPostProcess_TA` exist in TAGame. No Stadium_P, explosion or GameInfo content uses them.

**The only in-match changes are camera fades**
- Mechanism: `GammaOverlay = FadeA·FadeColor` and `GammaColorScale = (1−FadeA)·ColorScale`, baked into the LUT (§5.6) and applied in display space.
- **Map start** [S] (*PX* 4265 `Camera_X.OnLoadingMovieClosesd`): `SetCameraFade(true, (0,0,0,0), 1)`, a fade-in from black over 1 s when the loading movie closes.
- **Goal replay** [S] (*TA* 15813 `CameraState_LiveReplay_TA.BeginCameraState` / `EndCameraState`):
  - BeginCameraState sets `Camera.FadeColor = MakeColor(0,0,0)` (alpha defaults to 255, opaque black), then
    `SetCameraFade(true, MakeColor(0,0,0,1), 0.5)`: a **0.5 s fade-in from black** at the replay's start;
  - EndCameraState resets FadeColor to opaque black and fades to (0,0,0,0) over 0.5 s: another 0.5 s fade-in from
    black at the end (matches GS-10). Corrected 2026-10-10; the earlier "invisible, α 1/255" read the target, not
    the start;
  - replay slow motion (`ReplayDirector.bSlomo`) has no post-process.
- **ColorScale:** `SetDesiredColorScale(WorldInfo.DefaultColorScale = (1,1,1), 5)` (*PX* 4272), i.e. identity.

**Outside a match**
- Replay viewer only [S] (*TA* 79129, 37158):
  - ReplayFX DOF overrides (`CacheReplayFXPostProcessSettings`: DOF distance/kernel/far blur);
  - image filters (Sepia, Grayscale, … the F*ImageFilterPixelShader set);
  - `BloomScale` console command, reset to 1 on exit.
- Menus use their own map chain (Menu_PP).

## 10. three.js implementation

**Built-ins to turn off**
- `renderer.toneMapping = THREE.NoToneMapping`.
- `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`.
- No `OutputPass`. The last custom pass writes display-encoded values straight to the canvas. Do **not** add an sRGB encode.
- Keep albedo textures `SRGBColorSpace` so the scene stays linear.

**Targets**
- `S`: full-res HalfFloat colour + depth texture (linear HDR, with fog/translucency/flares).
- `Sh`: half res. `Q*`: quarter res. `E`: 1/8 res. `X`: 1/16 res.
- Blur samples outside the view rectangle must read 0 (clamp-to-border black, or a UV-range mask), not clamp-to-edge.

**Passes**
1. `Sh = box2x2(S)`; also store the linear view depth (half-res mean).
2. `Dq = box2x2(Sh)` → `(c·b(d), b(d))`. Gaussian(r = s², separable, §5.4 taps).
3. `H`: `w = 1 − b(d_h)`; `H.rgb = (Sh·w + Dq.rgb)/(Dq.a + w)`; `H.a = w`. Dropping the 0.25/4 storage pair is equivalent in float targets.
4. Bloom gather, quarter res. 4 taps at (±1.16, ±1.16) half-res texels of `H.rgb`; `w = sat((max3(c) − 2)·0.5)`; `G = mean(c·w)·BloomScale`.
5. `E = box2x2(G)`, blur r_m. `X = box2x2(E)`, blur r_l. `Q = ws·G + wm·up(E) + wl·up(X)`, blur r_s. This is the bloom texture.
6. Final pass (below).

Because the DOF term is constant inside the arena, a cheaper approximation of steps 1–3 is valid there: `C1 ≈ 0.75·S + 0.1875·up(Sh) + 0.0625·up(Gauss_q)`. Keep the depth-dependent b for the sky and far stands (up to 0.6).

```glsl
// constants (Stadium): A=0.22, B=1.0275, Z=0.255447, W=1.0, T=0.5
vec3 rlTonemap(vec3 x) {
  x = clamp(x, 0.0, 65503.0);
  vec3 R = 1.0275 * x / (x + 0.22);
  vec3 G = pow(x, vec3(1.0 / 2.2));
  vec3 P = mix(G, R, clamp((x - 0.255447) * 10000.0, 0.0, 1.0));
  return clamp(mix(P, R, 0.5), 0.0, 1.0);
}
// exact remap: piecewise-linear over 16 nodes (uniform float fR[16], fB[16] from §5.6), or analytic:
vec3 rlRemap(vec3 d) {
  vec3 c = clamp(d - vec3(0.0, 0.0, -0.003), 0.0, 1.0) * 1.25;
  return min(pow(max(c, vec3(1e-8)), vec3(1.3)), vec3(1.0));
}
void main() {
  vec3 S  = texture(tScene, vUv).rgb;
  vec4 H  = texture(tHalf, clamp(vUvHalf, halfMin, halfMax));     // H.rgb unscaled (if stored /4, use 4*H.rgb)
  vec3 C1 = clamp(mix(H.rgb, S, H.a), 0.0, 65503.0);
  float k = clamp(10.0 * exp2(-3.0 * dot(C1, vec3(0.30, 0.59, 0.11))), 0.0, 1.0);
  vec3 C2 = C1 + texture(tBloom, vUv).rgb * bloomScaleTint * k;  // bloom stored unscaled
  gl_FragColor = vec4(rlRemap(rlTonemap(C2)), 1.0);
}
```

**JS tap generator:** a direct port of §5.4 (`gauss_taps` in `ref/pp_ref.py`). Use the drawing-buffer width for s.

## 11. What ships and what is game data

**Ships as values** (facts and parameters, no assets)
- The tonemapper rule and constants (A, B, Z, W, T, from Range 8, Toe 0.5, Scale 1).
- Remap parameters (shadows, highlights, midtones, desaturation, colorize, DisplayGamma) and the 16 node values computed from them.
- Bloom: threshold 2, soft knee /2, gather offsets 1.16, BloomScale, Tint, ScreenBlend 10, kernel base 32, size scales (0.25/2/4) with clamps, weights (0.125/0.375/1) with normalisation, the Gaussian tap rule, MaxFilterBlurSampleCount 16, FilterDownsampleFactor 4, s = W/1280.
- DOF parameters, motion-blur scalars, AO scalars, light-shaft scalars.

**Not needed**
- There is no game LUT texture in Stadium. `postprocess_fx.LUT.LUT_Basic01` exists in Startup but is used by no match chain. Nothing has to be fitted.

**Local only (game-derived)**
- `out/bsim/agents/PP1/gsc/*` shader listings.
- `out/bsim/agents/PP1/decrypted/Stadium_OOB_Audio_Map.upk`.
- The Ghidra copy `out/bsim/agents/PP1/rl-live`.

## 12. Confidence and open questions

**Confidence per item**

| Item | Confidence |
|---|---|
| PP-1, PP-2, PP-3, PP-4, PP-5, PP-7, PP-9, PP-15, PP-16, PP-18 | High (shader math and native constant code read directly) |
| PP-6 | High on the math. Back-buffer format (non-sRGB UNORM) is [I] |
| PP-8 | High on the rule. Medium on exact texel alignment and the 1-texel borders of the filter buffers |
| PP-10 | Medium-high. The view DOF params come from the proxy (`0x14043cdd0`); the settings-interpolation steady state is [I] |
| PP-11 | Superseded by PP-21..23 (High; TS Medium) |
| PP-12, PP-13 | Superseded by PP-24..26 and PP-27..29 (High; PP-29's outcome Medium) |
| PP-17 | Medium |

**Open questions**
1. Motion-blur constants: cb15, cb25 and the cb27–45 sample tables in `FUberHalfResPixelShader1010`, set natively in `0x14059ff10`'s path. Not decoded.
2. SSAO shader formula (TAmbientOcclusionPixelShaderFLowQualityAO) and the blend state; only the parameters are known.
3. Light-shaft constant mapping:
   - cb19.x/y/z/w, cb20, cb21, cb27 → OcclusionDepthRange, BloomScale, pass index, OcclusionMaskDarkness, Tint, threshold;
   - number of blur passes;
   - exact insertion point relative to translucency.
4. LUT render-target format (8-bit vs float): ≤ 0.0046 difference. Closed 2026-10-10: use the clipped (8-bit) nodes.
5. Whether `*SystemSettings.ini` are read (config IO). The defaults stated here assume they are.
6. The AA option's true out-of-box default (list default 0 = Off).
7. **Suggested live checks** (live session, offline game):
   - A screenshot of the sky and far stands should look blurred (60 % far DOF) compared with the arena.
   - A grey or white object should clip at linear ≈ 0.77.
   - Toggling the Depth of Field option should visibly sharpen the whole arena (the 25 % MinBlur softening).


**Part 2 (2026-10-10):** open questions 1, 2, 3, 5 and 6 are answered by PP-21..32 below. PP-16: the weather default is
True and the AA default Off; the ini chain is read (PP-32). PP-17's order is replaced by part 2 §18 (shafts after
translucency; the velocity pass after the shafts; fog per notes/arena-surroundings.md FOG-10/12).

**PP-31 open item 4 settled (2026-10-10, CAP1):** the GrassCube is sampled through an sRGB view (R8G8B8A8_UNORM_SRGB), so the pow(1/2.2) store is decoded before filtering. Details and the clone recipe are in notes/arena-surroundings.md SUR-32.

## 13. Quality settings and gates (GQ1, 2026-10-16)

From the Video tab's script (TAGame `InitVideoSettings` / `SetRenderDetailValue`, live script dump TA:54900-55327), the
settings movie (SET:60313-60404), UserSettings.int and the snapshot's BaseSystemSettings.ini (BSS) and
DefaultSystemSettings.ini (DSS). Tags as above; [N] = native, not decoded. Menu labels and options: notes/hud-menus.md MENU-19..21.

**Presets ("Render Detail": High Quality / Quality / Performance / Custom)** [S → C]:

| Switch | High Quality | Quality | Performance |
|---|---|---|---|
| Texture Detail → bucket | TexturesHigher | TexturesHigh | TexturesMedium |
| World Detail → DetailMode | 2 (decals on, cull ×1.0) | 1 (decals on, cull ×0.5) | 0 (StaticDecals off, cull ×0.5) |
| Particle Detail → ParticleLODBias | 0 | 0 | 1 |
| High Quality Shaders (bAllowHighQualityMaterials) | on | on | off |
| AO / DOF / Bloom | on | off | off |
| Light Shafts / Lens Flares / Motion Blur | on | off | off |
| Dynamic Shadows | on | on | off |
| Weather (bShowWeatherFX) | on | on | off |

Presets don't touch Anti-aliasing, Render Quality (ScreenPercentage 100/85/70/55, separate), the FPS cap, V-Sync or Effect
Intensity. Any advanced change, **and Anti-aliasing or Render Quality**, switches Render Detail to Custom; Lens Flares, Weather
and Effect Intensity don't. Texture buckets (MaxLODSize, LODBias 0): Higher 2048 (Cinematic 4096); High 1024 (RenderTarget
2048); Medium 1024 for World/Character/Vehicle/UI/Cinematic/Lightmap/Shadowmap, 512 for specular, Effects, Skybox, Weapon,
256 WeaponSpecular; Low (UI only) 1024/512/256; Derp 128 (not in the UI). Fixed: MaxAnisotropy 4, MaxMultiSamples 1, no
temporal AA, MaxDrawDistanceScale 1. [SystemSettingsProfileDetailLow/High] are dead (no reference).

**Corrections to §7 and others:** Weather Effects defaults **on** (VideoSettingsSave_TA archetype bShowWeatherFX True; HUD1's
table said off); Quality keeps High Quality Shaders and Dynamic Shadows; Performance also turns off High Quality Shaders,
Dynamic Shadows and Weather, and sets StaticDecals off with decal cull ×0.5. PP-14: all 24 lens flares are DM_High, and 10
are HiddenGame and not auto-activated, so 14 show by default. Effect Intensity and Weather have no users in Stadium_P,
GameInfo_Soccar_SF, the Octane, Boost_Standard or Explosion_Default.

**Gating rules** [A data; rules UE3 [I]]: a component draws only if its DetailMode ≤ the system DetailMode (DM_High: World
Detail High Quality only; DM_Medium: High Quality and Quality); an emitter with MediumDetailSpawnRateScale 0 spawns nothing
below High; ParticleLODBias is added to a system's LOD and clamped (only 2-LOD systems change; LOD 1 is also used beyond the
system's LOD distance at any setting); High Quality Shaders off uses each material's low-quality resource where one exists.

**Effect map (QG)** — what each switch changes in what Carball builds:

| # | Effect (note) | Changed by | How |
|---|---|---|---|
| QG-1 | Bloom PP-7..9 | Bloom (off in Quality, Performance) | passes skipped |
| QG-2 | DOF soft layer PP-10 | Depth of Field (off in Quality, Performance) | no softening |
| QG-3 | Tone map, LUT, fades, height fog | none | always run |
| QG-4 | SSAO, motion blur, light shafts, lens flares, car shadows | AO, MB, Light Shafts, Lens Flares, Dynamic Shadows | not built in Carball (no-op rows) |
| QG-5 | Grass H-1/AV-6a | HQ Shaders | LQ: no lightmap texture (× LightColor (0.768, 0.698, 0.530)); no GrassCube, instead + 0.15·(Σᵢ sat(2(\|cᵢ\| − 2/3)))²·lerp(2P0, 2P1, sat(Y/4096 + 0.5))·ENVAmount with c the normalised tangent camera vector; no RockyDirt normal; view factor 3·((1 − c.z)⁴ + 1/3); noise factor 0.285·(n + 1.5) with k = 0.02125·((1 − c.z)⁴ + 0.25); skin, team lines and the Y = 0 switch unchanged. Blade meshes and Field_STD_Floor_Thick are DM_High (not built) |
| QG-6 | Markings H-2, generators H-7, glow strips H-5 | none | no visible LQ difference |
| QG-7 | Hex panels H-3 | HQ Shaders | Hexagons_N and carbon detail normals dropped (flat cells); GrassCube reflection kept |
| QG-8 | Frames and trims H-4 | HQ Shaders | only FrameTexture_N + PACK: no GrassCube reflection, no tire marks, no detail normals |
| QG-9 | Lower glass H-6 | HQ Shaders | rgb = 1/12 constant; alpha unchanged |
| QG-10 | Cage H-8 | HQ Shaders | LQ out = colour × fog, colour as H-8 with t = sat(Y/128 + 0.5), I = 1: no parabola profile, ball glow, scan stripes, rings or shockwave |
| QG-11 | Ball overlay H-9 | HQ Shaders | alpha = 0.25·ForcefieldHex.R (the faint net only); colour unchanged |
| QG-12 | Sky H-10 | HQ Shaders | gradient only, v·lerp(base + q⁴·warm, horizon, w): no clouds, no stars; fog bowl unchanged |
| QG-13 | Crowd, boards, scoreboards, roof | HQ Shaders | drop the sphere normal / the noise texture / the noise texture / three normal maps; grate and board backs unchanged |
| QG-14 | Canopy glass (Stadium_Glass, _02), floodlight flare sheets, haze shell (FogMesh_01 ×2), the 3 big far fog sheets ((−2441, −30406), (−41904, 49), (−416, 29904)), city window lights (SkyScraperLights_01/02, SkyScraper_B_Lights), corner banner flags ×4 | World Detail Performance | DM_Medium: removed (mullions, (−20880, 49) and the low fog pair (48, ±7700), SkyScraper_C_Lights and the towers always drawn) |
| QG-15 | FogCylinder far band, 37 small poplars + LeafyTrees, scaffolds ×8 | World Detail Quality and Performance | DM_High: removed (the 3 big −X plaza poplars (−20600, −1528), (−20680, 1608), (−19880, 40) always drawn) |
| QG-16 | Always drawn | – | arena shell (cage, overlay, glass, glows, trims), country flags, bulbs, team beams, stands, crowd, screens, sky |
| QG-17 | Reflection capture | World Detail, HQ Shaders | re-captured with the gated set and material variants [I] |
| QG-18 | Big pad halo (VT-11a d) | World Detail Quality and Performance | MediumDetailSpawnRateScale 0 (already omitted in Carball) |
| QG-19 | Pad curtains (BoostPad_LightCone_03_Mat) | HQ Shaders | alpha = sat(0.375·S(v)·Brightness): no scrolling noise; colour unchanged |
| QG-20 | Pad glow / warm-up (BoostPad_Glowing_Mat) | HQ Shaders | no noise or scrolling bands: colour (1 + S)·BoostPad_Color, alpha = reveal·sat(0.375·S·Brightness) |
| QG-21 | Pad base, orb sprites, small-pad inlay; ball reticle, beam, far ring, clarity sphere | none | no LQ resource, no gate (the decal has no CullDistance; DynamicDecals stays on) |
| QG-22 | Ball material (VT-31 kept) | HQ Shaders | cube reflection without the arena-box parallax |
| QG-23 | Ball speed trail (not built) | World Detail | emitters 3–6 (four side ribbons) High only; main ribbon and emitter 7 always |
| QG-24 | Boost trail Boost_Painted_PS (VT-2) | Particle Detail Performance | LOD 1: SpawnPerUnit UnitScalar 64 (vs 32), half the puffs per distance; also beyond 3072 uu at any setting |
| QG-25 | Idle exhaust Drive_PS | Particle Detail Performance | LOD 1: X 25 (vs 6.5–12.5) × Y 50–100 (vs 25–50), alpha 0.15 (vs 0.5), still 10/s; also beyond 2500 uu |
| QG-26 | Wall dust Rock_PS, jump Jump_Metal_PS, respawn CarSpawn_PS | Particle Detail Performance | LOD 1: dust 16/s → 2/s; smaller bursts |
| QG-27 | Supersonic, goal explosion, demolition, field dust Grass_PS | none | one LOD, no gates |

**First run** [S][C]: on PC the defaults are fixed: High Quality everything, Render Quality 100, Anti-aliasing Off, every
toggle on, FPS cap = the display's highest refresh rate (initial value Engine.MaxSmoothedFrameRate: cooked 62 [A], live config
[N]); BSS/DSS give DetailMode 2, all post on, ParticleLODBias 0, ScreenPercentage 100, HQ materials, textures 2048, UseVsync
off. [SystemSettingsBucket1..5] all equal [SystemSettings], there's no compat ini or GPU table in the snapshot and no script
benchmark; the exe carries UE3's compat-detection strings ("AppCompat", "CompatLevelComposite", "firstinstall") and a
"MinimumSystemSettings.ini" / TexturesDerp path, whether they run is [N]. Consoles default "Video Quality" to Performance
(ScreenPercentage 70; 720p on one console). The game itself doesn't adapt to the hardware on PC.

**Open [N]:** whether the compat detection or MinimumSystemSettings path runs at first launch; the live initial
MaxSmoothedFrameRate; the script's `scale get bAllowHighQualityMaterial` typo (no "s": the box may read off on open).

## Appendix: native addresses (live 2026-10-06)

| What | VA |
|---|---|
| Uber blend PS constructor (parameter names) | 0x1405a1c50 |
| Uber blend SetParameters (tonemap/bloom constants) | 0x1405bfda0 |
| Uber proxy constructor | 0x1405a1e00 |
| CreateSceneProxy | 0x1405a7f30 |
| Uber Render | 0x1405be460 |
| DOF/Bloom proxy constructor | 0x14042e5d0 |
| Bloom pyramid | 0x1405bf4c0 |
| Gather driver / bloom gather params | 0x140453810 / 0x14042a500 |
| Gaussian blur / weights | 0x140a71120 / 0x140a6c840 |
| Bloom combine | 0x140a6c470 |
| Box downsample | 0x140a6e440 |
| Scene → half | 0x1404420a0 |
| DOF gather + blur | 0x1405c1080 |
| Half-res Uber pass | 0x1405c09d0 |
| DOF PackedParameters | 0x140456c20 |
| DOF params export | 0x14043cdd0 |
| DOF focus | 0x14043b7b0 |
| LUT draw / params / gamma / remap | 0x1404e5250 / 0x1404e6a80 / 0x1404e65f0 / 0x1404e6310 |
| Scene RT sizes (FilterDownsampleFactor 4) | 0x140a97130 |
| DisplayGamma default 2.2 | 0x140636a50 |
| Blend variant defines | 0x1405ba040 |
| System-settings table | 0x1422719f8 |

**Shader blobs** in `GlobalShaderCache-PC-D3D-SM5.bin` (offset / size):

| Shader | Offset | Size |
|---|---|---|
| FUberPostProcessBlendPixelShader02000 | 2226515 | 1840 |
| FLUTBlenderPixelShader<1> | 2474899 | 888 |
| FBloomGatherPixelShaderNumFPFilterSamplesFALSE | 2517830 | 1336 |
| TDOFGatherPixelShader | 2521639 | 1060 |
| FUberHalfResPixelShader0010 | 2012837 | 940 |
| FUberHalfResPixelShader1010 | 1996073 | 4472 |
| FDownsampleScene | 1846566 | 2472 |
| TFilterPixelShader<4> | 1840687 | 984 |
| TDownsampleLightShafts<Directional> | 1854527 | — |
| FBlurLightShafts | 1852759 | — |
| FApplyLightShafts | 1850602 | — |
| TAOApply<Normal> | 1928977 | — |

---

# Part 2: motion blur, SSAO, light shafts, lens flares, the reflection-cube blur (PP-21..32, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent PP2 with a polarity-fixed DXBC disassembler
(out/bsim/agents/PP2/tools/dxbc.py; AV0's tool prints every conditional branch as _z; specs that relied on a branch direction were re-checked on 2026-10-10 by DXB1: none changes).
The static session confirmed the polarity bug (controls bit 0x80 = D3D10 test-boolean bit 18; AV0 tests 0x40).

Static session spec draft, 2026-10-10. Drafted by sub-agent PP2 as a continuation of `notes/post-processing.md`
(PP-1..20). Live build 2026-10-06, map Stadium_P. Numbering continues at PP-21.

**Tags** (as in part 1)
- [A] package data (decrypted Startup / Engine / Stadium_P / TAGame).
- [S] UnrealScript (*TA* = `out/bsim/work/tagame_live_all.txt`).
- [N] native code: live `RocketLeague.exe` VAs, read in the private Ghidra copy `out/bsim/agents/PP2/rl-live`.
- [M] shader bytecode: GlobalShaderCache offsets (as in part 1) or RefShaderCache ids.
- [I] inferred.

**Tooling note, important for every spec that cites shader listings [M]**
- `out/bsim/agents/AV0/dxbc.py` decodes the D3D10 "test boolean" bit from bit 17 instead of bit 18
  (`controls & 0x40` instead of `0x80`). Every `if`, `breakc`, `continuec`, `retc` and `discard` is printed as `_z`,
  even when it is `_nz`.
- So in every listing made with it (PP1's `gsc/*.txt` and the AV0, AV1, AVQ, CAR2, FX1, FX2, LMP2 and SUR1 material
  listings), **the printed branch polarity is unreliable**: every `_z` there is really `_nz`, except 50 in PP1's
  `gsc/misc.txt` (the AA shaders), which really are `_z`. PNT1's `shaders/*.asm.txt` come from Microsoft's D3D
  disassembler and are correct. Example: the motion-blur shader's `if_z` is really `if_nz`; a masked material's
  `discard_z` is really `discard_nz`.
- The fixed copy is `out/bsim/agents/PP2/tools/dxbc.py` (one-character change). Listings in `out/bsim/agents/PP2/gsc/` use it.
- **Re-checked 2026-10-10 (DXB1; every conditional in those listings was re-disassembled with the fixed tool): no spec
  claim depended on the printed polarity.**
  - Every alpha test is clip-style, and the specs keep the side above the threshold (SUR-20/27/43, the demolition
    and distortion assets).
  - The vertex-fog branch takes the exponential path when the fog flag is set (FOG-6/10, SUR-23/24, H-10).
  - The other material `if`s are the engine's dynamic-shadow gate.
  - The PP loops and the motion-blur branch (§3, §5.4, §6) stand.
  Plain arithmetic is unaffected.

**Parameter mapping method [M][N]**
- Global shaders carry no RDEF. After each DXBC blob the GSC record holds the shader's serialised parameters as u16
  triples, in field order:
  - `(BaseIndex, NumBytes, BufferIndex)` for constants;
  - `(BaseIndex, NumResources, SamplerIndex)` for textures.
- These were matched to the native `Bind` calls (parameter names) and to the native `SetParameters` code (values).
- Tool: `tools/gsc_dump.py` (listing + tail).

---

### Numbered summary

**PP-21 — Motion blur: velocity sources [N][M]**
- **Camera motion (all pixels):** per-pixel reprojection from depth with the previous view-projection matrix.
  - Applies only while FullMotionBlur is on (class default True).
  - View depth is capped at 1000·near (device z ≤ 0.999).
  - Pixels with depth < 14 uu are treated as infinitely far (rotation only).
- **Object motion:** a full-resolution RGBA8 velocity buffer, drawn after world translucency.
  - Drawn for visible movable opaque or masked primitives that moved since the last frame: cars, wheels, ball [I on the exact list].
  - Cleared to 0. A pixel counts as "dynamic" when R + G > 0.
  - Each such pixel stores the full screen motion, object plus camera.
- The buffer is allocated only when the MotionBlur setting is on (`0x140a89e60`).

**PP-22 — Motion blur: scale, clamp and samples [N][M]**
- **Blur vector** (pixels) b = A·TS·Δpx, clamped to |b| ≤ 0.0125·MaxVelocity·W (W = view width).
  - A = MotionBlurAmount 0.25, MaxVelocity 1.
  - TS = 2: a fixed time scale. The frame-rate-dependent alternative 1/(30·dt) is selected by a flag that nothing writes.
  - So b = **half of the frame's screen motion**, clamped at 24 px at 1920.
- **Samples:** 5 taps on the half-res scene at the pixel and at ±0.2·b and ±0.4·b along the blur vector (exact form in §13).
  - Equal weights 0.2.
  - Each neighbour is rejected by velocity difference: w·max(1 − 10·|e_i − e_c|², 0), on the 8-bit encoded velocities.
- **Blend:** weight m·w, with m = |b|/(0.0125·W) and w = 1 − DOF blur amount (0.75 in the arena).
  - The translucent sample tables are never used: the velocity buffer's B channel is always 0.

**PP-23 — Motion blur: camera cuts, setting, default [N][A][S]**
- **Reset** (no camera blur that frame) when:
  - any camera axis turned more than 90° (CameraRotationThreshold), or
  - the camera moved more than 10000 uu, or
  - it is the first frame or the time was reset.
- **Setting:** video option "Motion Blur" → `scale set MotionBlur` (global `0x142272dd8`).
- **Default:** on (DefaultSystemSettings `MotionBlur=True`, High preset). The Medium and Low presets turn it off.
- `MotionBlurPause=True`: while the world is paused the velocities are kept [I].

**PP-24 — SSAO algorithm [M][N][A]**
- **Variant:** UE3 angle-based SSAO, `TAmbientOcclusionPixelShaderFLowQualityAO<·,TRUE>`, AO_Low.
- **Resolution:** a half-resolution AO buffer storing (min, max) of each 2×2 block of view depths; the max is used.
- **Samples:**
  - 2 sample pairs: two fixed vectors reflected about a per-pixel noise normal; xy only.
  - Radius min(12 uu, 70 px worth at depth d).
- **Per pair:** occlusion from the angle between the two sample vectors; only concave configurations count.
- **Halo rejection:** a sample in front by more than 20 + 0.1·d uu is dropped.
- **Remap:** U^4·4 + 0 → saturate.
- **Fade-out:** the result fades to 1 between 4000 and 4500 uu.
- **Floor:** max(·, MinOcclusion 0.375).

**PP-25 — SSAO filter and application [N][M]**
- **Filter:** 2 depth-aware 4-tap passes (horizontal, then vertical), taps at −2, −1, 0, +1 AO texels.
  - Centre weight 1.2; the others 1.2 − min(1e-4·Δd², 1).
  - No temporal history: HistoryConvergenceTime = 0.
- **Apply:** a full-screen pass right after opaque lighting, before height fog and all translucency.
  - It multiplies the **whole opaque scene colour**: lightmaps, dynamic lights and emissive alike.
  - Blend: OcclusionColor·(1 − AO) + Scene·AO with OcclusionColor black, i.e. Scene·AO, RGB only.

**PP-26 — SSAO noise [A][M]**
- `EngineMaterials.RandomNormal2`: 32² RGBA8, but its content is **16 distinct unit vectors in a 4×4 tile**, repeated.
- Mapped one texel per AO-buffer pixel, so the pattern repeats every 4 AO pixels (8 screen pixels at AO_Low).
- The 4-tap filter spans exactly one period, so it cancels the pattern.
- **Ship:** a generated 4×4 table of 16 well-spread random unit vectors. Statistics are in §14.4.

**PP-27 — Sun light shafts: passes and constants [N][M][A]**
- **Three passes:**
  1. Quarter-res downsample: bloom candidate + occlusion mask.
  2. **One** radial-blur pass of 64 taps toward the sun.
  3. Full-res apply, blend One / SrcAlpha on RGB.
- **LightShaftParameters** = (1/OcclusionDepthRange, BloomScale, RadialBlurPercent/100, OcclusionMaskDarkness) =
  (1/200000, 2, 1, 0.75).
- **Other constants:** BloomTintAndThreshold = (1, 1, 1, 0.2); BloomScreenBlendThreshold 1; DistanceFade 0 (directional).
- Formulas are in §15.

**PP-28 — Light shafts: placement and cutoff [N]**
- **Position in the frame:** after the World-DPG translucency, before the velocity pass and the Foreground DPG
  (lens flares). This corrects PP-17, which put the shafts before translucency.
- **Origin:** the sun's projected position.
- **Cutoff:** the whole effect is skipped only when the sun is behind the camera plane (clip w < 0).
  An off-screen sun in front still renders; the radial terms do the falloff.

**PP-29 — Light shafts in practice [N][I]**
- **What it does:** the downsample reads the depth-capped scene depth (≤ 1000·near = 10000 uu with near 10).
  - The bloom mask needs d > 100000, so the shafts **add nothing**.
  - The occlusion mask stays at its screen-edge floor (1 − 8·u(1−u)v(1−v))^4.
  - So the effect is a **darkening** of up to 25 % (D = 0.75), strongest near the screen centre and toward the sun.
  - It fades with distance from the sun's screen position over 2 view widths.
  - It occurs whenever the sun (−X, 23° up) is in front of the camera.
- Depends on the main-view near plane being 10 (`GNearClippingPlane` default 10.0 at `0x142260448`; no Engine.ini).
  FOG1 should confirm the near plane.
- Live check suggested.

**PP-30 — Lens flares [A][S][I]**
- **Visible in a match:** only **14 of the 24** StaticLensFlareSource components.
  - The 10 hidden ones: 6 StadiumLights_* and 4 ScoreboardFlare. They are HiddenGame, bAutoActivate False, and no
    Kismet or script reveals them.
- **The 14:**
  - 12 SpiralRainbow_LF at the light rigs of the −X half;
  - SunGlow_LF and Sun_LF at the visual sun (az 180.5°, el 11.1°).
- **Elements:** every enabled element has RayDistance 0, so all sit at the source's screen position. There is no
  ghost chain.
- **Materials:** all additive and unlit.
- **Occlusion:** a bounding-box occlusion query mapped through ScreenPercentageMap [I].
- Per-element data and open points are in §16.

**PP-31 — Reflection-capture blur chain (GrassCube) [N][A][M]**
- **Per face:** each of the 6 faces is a separate 256² scene view with its own post-process chain
  `Cubemap_Blur64_PP` (a DOFAndBloomEffect).
- **The blur:** MinBlurAmount 1, so the face is 100 % the DOF layer.
  - Quarter-res (64² per face) separable discrete Gaussian, variance r = 64/4·(256/1280) = **3.2 texels²**.
  - 9 taps (−4…4); weight-normalised, so the face edges are not darkened.
  - Bilinear upsample to the face.
  - Effective σ ≈ 7.2 face pixels (≈ 2.9° at the face centre), **not** a 64-px blur.
- **Order and store:**
  - The blur runs in float HDR, **before** the 8-bit store.
  - It is **per face, not seamless**: the GGX "seamless" pass exists but `PostMethod` = None for GrassCube.
  - Then saturate, encode with pow(1/2.2), store in the A8R8G8B8 cube.
- **Bloom:** the DOFAndBloom bloom (threshold 1) is computed but the blend shader has no bloom input, so it does not
  reach the cube [M][I].
- This settles RV-129.

**PP-32 — Config and defaults [N][A][S]**
- **System settings come from the ini chain:**
  - The `*SystemSettings.ini` files **are read**: the FSystemSettings loader (`0x140571ec0`) reads `[SystemSettings]`
    through GConfig and follows `BasedOn`.
  - The compiled defaults of the setting globals are all 0 (MotionBlur, Bloom, AO, MaxFilterBlurSampleCount, …).
  - So the shipped values (DefaultSystemSettings over BaseSystemSettings, then the user's generated
    TASystemSettings.ini) are what the game uses.
  - The "IO operations are currently disabled" message is a run-time guard in `FConfigFile::Read` (`0x1402f3650`),
    not a build-wide switch.
- **AA default:** Off.
  - Standard_PP has PostProcessAAType 0, and the PostProcessManager_TA class default is 0.
  - The UI list default is `EnumToString(0)` = Off.
- **Correction to PP-16:** VideoSettingsSave_TA defaults bShowWeatherFX, bShowLightShafts and bShowLensFlares to True.

---

### 13. Motion blur, exact (FUberHalfResPixelShader1010)

#### 13.1 Constants [N] (`0x1405a0ab0` = FMotionBlurShaderParameters::Set; bind `0x1405a1650`)

**Inputs**
- View params come from the Uber proxy through `RequiresVelocities` (`0x1405c1320`). It copies proxy+0xbc..0xd0:
  Amount 0.25, MaxVelocity 1, FullMotionBlur 1, rotation threshold 90, translation threshold 10000, and a paused flag.
- aspect = W/H.

**Scalar definitions**

| Symbol | Formula | Value |
|---|---|---|
| k | 0.0125·MaxVelocity (MAX_PIXELVELOCITY = 16/1280) | 0.0125 |
| TS | `ViewState+0x288`: 2.0 when `DAT_1424b48e4` = 0, else clamp(1/(30·DeltaWorldTime), 0, 1000) (`0x140a721b0`) | 2.0 |

- `DAT_1424b48e4` is .bss with no writer found (RIP scan of .text: one read only). So TS = 2 [N; I that nothing
  else writes it].
- At 60 fps both forms give 2. At other frame rates the fixed form blurs half a frame of motion; the
  frame-rate-dependent form would blur a fixed A/30 s = 8.33 ms of motion.

**Constant buffer (cb0 index → parameter)**

| cb0 | Parameter | Value |
|---|---|---|
| 14 | RenderTargetClampParameter | the half-res view rect in UV, inset ½ texel |
| 15 | MotionBlurMaskScaleAndBias | (80, 80/aspect, 0, 0) |
| 20–23 | PrevViewProjMatrix | ScreenToWorld (z row ×0.999, w = −0.999·near-term) × previous ViewProj, rows x, y, w used |
| 24 | StaticVelocityParameters | (0.5·A·TS/k, −0.5·A·TS/(k·aspect), 0, 0) = **(20, −20/aspect)** |
| 25 | DynamicVelocityParameters | (k, k·aspect, 0.1, 0.1/aspect) |
| 26–30 | StepOffsetsOpaque[5] | 0, 0.2, −0.2, 0.4, −0.4 (element 0 unused) |
| 31–35 | StepWeightsOpaque[5] | 0.2 ×5 (element 0 = centre) |
| 36–40 | StepOffsetsTranslucent[5] | 0, 0.2, 0.4, 0.6, 0.8 (unused) |
| 41–45 | StepWeightsTranslucent[5] | 0.2 ×5 (unused) |

**Textures:** t1 = VelocityBuffer, t2 = LowResSceneBuffer (half-res scene), t0 = scene depth.

**At common widths**

| Width | Static scale | Max blur | Max tap offset (0.4·max) |
|---|---|---|---|
| 1280 | (20, −11.25) | 16 px | 6.4 px |
| 1920 | (20, −11.25) | 24 px | 9.6 px |
| 2560 | (20, −11.25) | 32 px | 12.8 px |
| 3840 | (20, −11.25) | 48 px | 19.2 px |

#### 13.2 Velocity buffer writer [M][N]

- **Shader:** `FVelocityPixelShader` (per material). Vertex shader example: RefShaderCache id 4405511e…; pixel shader
  example: 29ffee28….
- **Setter:** `0x140aaeb30`.
- **What the vertex shader passes:** the current translated-world position, and
  Δ_obj = clip(cur) − clip(prev object transform, current camera).
- **Pixel shader:**

```
Δ_cam = clip.xy(p with current camera) − clip.xy(p with previous camera)          // via PrevViewProjectionMatrix
V     = (Δ_obj.xy·S_obj + Δ_cam.xy·S_cam) / clip.z                               // clip.z ≈ w (UE3 infinite-far projection)
S_obj = (0.5·A·TS·MotionBlurInstanceScale/k, −same/aspect)                         // instance scale = 1 (class default)
S_cam = FullMotionBlur ? (0.5·A·TS/k, −same/aspect) : 0
V     = |V| > 1 ? V/|V| : V
out   = (0.5·V + 0.5, 0, 0)       // RGBA8, B = A = 0
```

- **Format:** RGBA8 (`PF_A8R8G8B8`), full resolution (`0x140a89e60`).
- **Primitives drawn:** the velocity pass (`0x140aac640`) takes primitives whose proxy flag (+0x90 bit 0x20) is set
  and which pass the "has moved" test (`0x140aa80d0`).
- A second group is drawn with MaxVelocity forced to 0, i.e. zero velocity [N, purpose I].

#### 13.3 Half-res pass with motion blur [M] (fixed polarity)

Inputs: uv = half-res UV; P = screen position in NDC; e = velocity buffer texel.

```
w      = 1 − b(d_h)                                    // DOF weight, part 1 §6 (0.75 in the arena)
Hdof   = (S_h·w + 4·D.rgb)/(4·D.a + w)                 // part 1 §6 composite (unscaled)
e      = Velocity(uv)                                  // encoded 0..1
if (e.r + e.g > 0)  v = 2·e.rg − 1                     // dynamic pixel
else {                                                 // static pixel: camera reprojection
   d    = min(devZ, 0.999) → linear depth; if d < 14: d = 65504
   Pp   = PrevViewProjRows · (P.x·d, P.y·d, d, 1)       // previous clip (x, y, w)
   v    = (P − Pp.xy/Pp.w) · StaticVelocity.xy        // = Δuv·A·TS/k, y flipped/aspect-corrected
}
if (|v| > 1) v /= |v|
step   = v·(k, k·aspect)                               // UV
acc    = S_h·0.2 ;  wsum = 0.2
for o in (+0.2, −0.2, +0.4, −0.4):
   q    = clamp(uv + step·o, RTClampMin, RTClampMax)
   s    = 0.2·max(1 − 10·|Velocity(q).rg − e.rg|², 0)
   acc += LowRes(q)·s ;  wsum += s
MB     = acc / wsum
m      = min(|step·(80, 80/aspect)|, 1)                // = |v| for MaxVelocity 1
H.rgb  = 0.25·(Hdof + m·w·(MB − Hdof))
H.a    = w·(1 − m·w)                                   // full-res blend weight of the sharp scene
```

**Final composite (part 1 §3):** C1 = mix(4·H.rgb, S, H.a).
- At full speed in the arena (m = 1, w = 0.75): C1 = 0.1875·S + 0.203·Hdof + 0.609·MB.

**Soft-edge variant:** `…1011` uses TMotionBlurGather and depth-sign masks. It is selected only when
MotionBlurSoftEdgeKernelSize > 0; it is 0 in Stadium, so it is not used.

#### 13.4 Camera-cut detection [N] (`0x140a721b0`)

- The previous transforms are reset (PrevViewProj = current, so no camera blur) when any of these holds:
  - dot(row_i(R_now), row_i(R_prev)) < cos(90°) for any of the 3 view axes;
  - |camPos_now − camPos_prev|² > 10000²;
  - the previous render time ≥ the current one, or there was no previous frame.

### 14. Ambient occlusion, exact

#### 14.1 Parameters [A][N]

**Effect values** (Standard_PP `AmbientOcclusionEffect_1` over `Default__AmbientOcclusionEffect`; bUseWorldSettings False)
- Colour and remap: OcclusionColor (0,0,0,1); Power 4; Scale 4; Bias 0; MinOcclusion 0.375.
- Sampling: bAngleBasedSSAO True; Radius 12; Quality AO_Low.
- Fade-out 4000 → 4500.
- Halo: threshold 20, scale 0.1, HaloOcclusion 0.04 (unused by this shader).
- Filter: EdgeDistanceThreshold 10 / Scale 0.003 (not bound; the filter uses a fixed 1e-4); FilterDistanceScale 10.
- History: HistoryConvergenceTime 0 (no history), HistoryWeightConvergenceTime 0.07.
- bAffectsLightingOnly True, SDPG_World.

**Proxy** `0x140a108a0` copies the object fields (obj+0x98…0xe0) in declaration order.

**Constants (AO pass, `0x140a39210`)**

| cb0 | Parameter | Value |
|---|---|---|
| 4 | AOScreenPositionScaleBias | NDC → AO-buffer UV |
| 10 | NoiseScale | (AOBufX/32, AOBufY/32): one noise texel per AO pixel |
| 11 | ProjectionScale | (P00·sx, P11·sy); s = ScreenPositionScale |
| 16 | OcclusionCalcParameters | (Radius 12, 0, HaloDistanceThreshold 20, HaloOcclusion) |
| 17.x | HaloDistanceScale | 0.1 |
| 18 | OcclusionRemapParameters | (Power 4, Scale 4, Bias 0, MinOcclusion 0.375) |
| 19 | OcclusionFadeoutParameters | (4000, 1/500) |
| 20.x | MaxRadiusTransform | (70/BufferSizeX)/(sx·P00) |

**AO buffer**
- Downsample factor = 1 + (OcclusionQuality ≠ AO_High) = **2** (`0x140a2edc0` → `0x140a96f50`).
- `TDownsampleDepthPixelShader` writes (min, max) of the 4 linear depths of each 2×2 block; device z is clamped to
  0.999 first.

#### 14.2 Occlusion pass [M] (`TAmbientOcclusionPixelShaderFLowQualityAOFALSETRUE` @1934536)

The TRUE first argument uses the full projection matrix, which is identical for a symmetric projection.

```
d    = AO.y(uv)                              // max depth of the block
n    = 2·Noise(uv·NoiseScale) − 1            // RandomNormal2, see 14.4
s1   = (0.016987, 0.353134, 0.002735); s2 = (0.521023, −0.321706, 0.006338)
r    = min(d·MaxRadiusTransform, 12)         // view units; ≈ min(0.104·d, 12) at 1920, 110° hFOV: 12 above d ≈ 115
o_k  = (s_k − 2(s_k·n)n).xy · r              // k = 1, 2; z offset 0
P    = ray·d                                 // view space (ray.z = 1 [I])
for k:
  A = P + (o_k,0),  B = P − (o_k,0)
  uvA = (A.xy/d)·ProjectionScale + bias,  uvB likewise   // projected with the centre depth
  ΔA = AO.y(uvA) − d,  ΔB = AO.y(uvB) − d
  a = (o_k, ΔA),  b = (−o_k, ΔB)
  x = 1 − (a·b)/sqrt(|a|²|b|²)               // 0 … 2; 2 = flat
  if (ΔA + ΔB > −1e-5) x = 2                 // convex/flat pairs never occlude
  valid = (ΔA > −(20 + 0.1·d)) && (ΔB > −(20 + 0.1·d))     // halo rejection
  S += valid·x² ;  N += valid
U    = (4 + S) / (4·(1 + N))                 // 1 = open; the "+4/+1" is an implicit unoccluded centre sample
A    = saturate(U^4·4 + 0)
A    = A + saturate((d − 4000)/500)·(1 − A)
out  = (max(A, 0.375), d)                    // x = AO, y = depth (kept for the filter)
```

**Typical values**
- Flat surface: 1.
- A pair seeing a 90° concave crease: x = 1. Both pairs → U = 0.5 → A = 0.25 → clamped to **0.375**.
- One pair at 90° and the other halo-rejected → 0.61.
- So AO only darkens tight creases within ~12 uu (contact zones, under car bodies, wall/floor seams) by up to 62.5 %.

#### 14.3 Filter and apply [M][N]

**Filter** `TEdgePreservingFilterPixelShader` (`0x140a19f60` ×2, horizontal then vertical)
- cb22 = (AOBufX, AOBufY, Δu, Δv), with Δ = 1 AO texel along the pass axis.

```
taps t ∈ {−2, −1, 0, +1}·Δ:   w_t = (t == 0) ? 1.2 : 1.2 − min(1e-4·(d_t − d_0)², 1)
AO' = Σ w_t·AO_t / Σ w_t ;  depth passes through
```

**Apply** `TAOApplyPixelShader<AOApply_Normal>` (`0x140a0c7a0`)
- Shader output: rgb = OcclusionColor (0,0,0), a = AO (sampled at the pixel; bilinear [I]).
- Blend (`0x140a1c670`): Color = Src·InvSrcAlpha + Dest·SrcAlpha; write mask RGB.
- Result: **Scene.rgb ×= AO**.

**Position [N]** (`0x140a79750` → `0x140a7abf0(…, bAffectLightingOnly = 1)`)
- After the opaque base pass and lights, **before** height fog (`0x140a2f620`) and world translucency (`0x140aaac50`).

#### 14.4 Noise texture, derived form (shippable) [A]

**What the asset is**
- `EngineMaterials.RandomNormal2` (Startup.upk): 32×32 PF_A8R8G8B8, TC_Normalmap, decoded as 2·c − 1.
- It holds 16 distinct unit vectors (|v| = 1.003 ± 0.003), each used 64 times, tiled with period 4 in x and y.

**Statistics of the 16 directions**
- Mean (−0.09, 0.06, −0.06).
- Second-moment diagonal (0.41, 0.33, 0.26); off-diagonals ≤ 0.06.
- Half have z > 0.
- Largest pairwise cosine 0.96.

**Reflected-offset lengths**
- |o_1|/r: mean 0.30 (0.15–0.36).
- |o_2|/r: mean 0.51 (0.28–0.62).

**Ship:** a generated 4×4 table of 16 well-spread unit vectors, e.g. a 16-point Fibonacci sphere in a shuffled
4×4 order.
- It reproduces the per-pixel rotation of the two-pair kernel and the period-4 structure that the 4-tap filter cancels.
- The exact vectors stay local (`tools/` scripts regenerate the statistics from the local package).

### 15. Sun light shafts, exact

#### 15.1 Constants [N] (`0x140a61cf0`; bind `0x140a4dc30`)

**Light values**
- DirectionalLight__LC_1 [A]: OcclusionDepthRange R = 200000, BloomThreshold T = 0.2, BloomTint white,
  OcclusionMaskDarkness D = 0.75.
- Class defaults: BloomScale 2, BloomScreenBlendThreshold 1, RadialBlurPercent 100.
- Direction: from −X, 23.2° up (AV-17).

**Constant buffer**

| cb0 | Parameter | Value |
|---|---|---|
| 12.xy | TextureSpaceBlurOrigin | the sun position (light position → clip → ScreenPositionScaleBias) in "width units" (below) |
| 17 | UVMinMax | the view rect in filter-buffer UV, −1 texel |
| 18 | AspectRatioAndInvAspectRatio | converts filter UV to width units: P = (x/W, y/W) of the pixel, and back |
| 19 | LightShaftParameters | (1/R, BloomScale, RadialBlurPercent/100, D) |
| 20 | BloomTintAndThreshold | (1, 1, 1, 0.2) |
| 21.x | DistanceFade | 0 for directional; sat((dist + 200)/(5·radius)) for point/spot |
| 27.x | BloomScreenBlendThreshold | 1 |

**Run conditions** (`0x140a5c6c0`)
- bAllowLightShafts, and the light's bRenderLightShafts.
- BloomScale > 0.001 or D < 1.
- For a directional light: (ViewProj·(pos, 1)).w ≥ 0, i.e. the sun is in front of the camera plane.

#### 15.2 Passes [M][N]

1. **Downsample** to quarter resolution (FilterDownsampleFactor 4), `TDownsampleLightShaftsPixelShader<LS_Directional>`:

```
c̄    = mean of 4 bilinear scene taps (covers the 4×4 block);  L = max(lum(c̄), 6.1e-5)   // lum (0.3, 0.59, 0.11)
d_i  = 4 linear depths (device z ≤ 0.999)
bloom = 2·BloomScale·c̄·max(L − T, 0)/L · mean_i sat((d_i − R/2)/R)
e    = u(1−u)·v(1−v)  (u, v ∈ [0,1] across the view);  f = (1 − 8e)^4      // 1 at the edges, 0.0625 at the centre
occ  = max(mean_i sat(d_i/R), f)
bloom *= (1 − f) · (1 − min(5·|O − P|, 1))²                                   // only within 0.2 widths of the sun
store (0.25·bloom, occ)
```

2. **Radial blur, one pass** (`0x140a4d600` called with NumPasses = 1, RT2 → RT1), `FBlurLightShaftsPixelShader`:

```
D⃗ = O − P (width units);  ℓ = min(|D⃗|/2, ½·sqrt(|D⃗|/2))
step = 2·(D⃗/|D⃗|)·ℓ·RadialBlurPercent/100/64
for k = 0..63:  t_k = 2 − k/32;  q = clamp(P + k·step, UVMinMax)
   rgb += S(q).rgb·min(t_k, 4t_k²);  a += S(q).a·t_k
out = (rgb, a)/64                     // gains ≈ 1.011 (rgb), 1.016 (a)
```

- The total length is ≈ |D⃗| (reaching the sun) for |D⃗| < 0.5, else sqrt(|D⃗|/2).

3. **Apply**, full resolution, `FApplyLightShaftsPixelShader`:
   - Blend `0x140a1bf20`: Color = Src·One + Dest·SrcAlpha, RGB only.

```
B    = blurred (rgb, a)
m    = D + 1.5·(1 − D)·B.a²           // 0.75 … 1.125
m    = lerp(m, 1, min(|O − P|/2, 1))
m    = sat(lerp(m, 1, DistanceFade³))
k    = sat(BSBT·2^(−3·lum(Scene)))
Scene = Scene·m + sat(4·k·Tint·B.rgb)
```

#### 15.3 What it does in Stadium [N][I]

**With main-view near = 10**
- The view depth is capped at 10000 < R/2 = 100000, so **bloom = 0** everywhere.
- occ ≈ max(d/200000 ≤ 0.05, f) ≈ f.
- Result:
  - **Scene ×≈ 0.75 + 0.375·f̃²**, where f̃ is f blurred toward the sun;
  - then lerped to 1 over 2 view widths from the sun's screen point.
- So it is a centre-weighted darkening of up to 25 % whenever the sun is in front (looking toward −X).
- The edges stay near 1 (f → 1).

**If the near plane were ≥ 200** (d_max ≥ 200000)
- The sky would count as unoccluded (m = 1) and the near geometry would cast dark shafts.
- The sky within 0.2 widths of the sun with lum > 0.2 would add bloom.

The near plane is the deciding fact (FOG1 / live check).

### 16. Lens flares

#### 16.1 Sources [A] (Stadium_P; all SDPG_Foreground, DetailMode High)

| Template | Count | Visible in game | Positions | SourceColor |
|---|---|---|---|---|
| SpiralRainbow_LF | 12 | yes | light rigs: x −11584…2864, y ±11232…±15840, z 8848–9904 (all on the −X half) | (0.536, 0.406, 0.258) |
| SunGlow_LF | 1 | yes | (−485680, −4095, 95360): az 180.5°, el 11.1° (the HotSpot_Mat sun) | (0.381, 0.183, 0.048) |
| Sun_LF | 1 | yes | (−485328, −4480, 95216) | white |
| StadiumLights_YellowOrange_LF / _YellowGreen_LF | 3 + 3 | **no** (HiddenGame, bAutoActivate False) | light rigs, DrawScale 16 | — |
| ScoreboardFlare_LF | 4 | **no** (HiddenGame, bAutoActivate False) | scoreboards | (1.147, 0.869, 0.551) |

- No Kismet object refers to them [A].
- No TAGame script toggles StaticLensFlareSource [S].
- Separately, `GoalIndicator_TA` owns a LensFlareComponent shown on the viewer's offensive goal, with the template
  from LensFlareTeamList [S]. It was not traced here.
- The visual sun (el 11.1°) is lower than the sun light's direction (el 23.2°, which drives the shafts).

#### 16.2 Enabled elements [A] (disabled ones omitted)

| Template | Material (textures) | Size (x, y) | Color | Alpha | Flags | Curves |
|---|---|---|---|---|---|---|
| SunGlow_LF E1 | DustyFlare_Thick_Mat (FillFlare via UV0; DirtyLens_D, not by UV0 [I: screen-space dirt]) | 1, 1 | 0.5 × SourceColor | 1 | bNormalizeRadialDistance, bModulateColorBySource | ScreenPercentageMap: ease-out 0 → 0.993 over [0, 1] (20 samples) |
| Sun_LF E0 | HexStarFlare_Mat (Corona_Sun01_D), two-sided | 0.4, 0.3 | 1 | 1 | bNormalizeRadialDistance | SPM linear 0 → 0.446 over [0, 0.81] |
| SpiralRainbow_LF E0 | SpiralRainbowFlare_MIC (imported; not traced) | 0.5, 0.5 | 0.75 × SourceColor | 1 × DistMap_Alpha | bUseSourceDistance, bModulateColorBySource; Rotation 1.6 | DistMap_Alpha 0.023 → 1.009 over [0, ≈1]: at camera distances ≥ 1 uu it is 1; cone Outer 120° / Inner 100°, bUseTrueConeCalculation; SPM ≈ linear 0.008 → 1.016 over [0, 1] |

- All materials are BLEND_Additive and MLM_Unlit.
- Each template has bUseFixedRelativeBoundingBox, with half-extents (stored with Min > Max) of:
  SunGlow ±16384, Sun ±4096, SpiralRainbow ±64, StadiumLights ±256, Scoreboard ±512.
- The hidden templates, for completeness: StadiumLights E2 Rainbow_PartHalo_Mat 0.75×3, rot 1.507; colour
  (0.125, 0.0625, 0.0625) orange / (0.0625, 0.0625, 0.125) green; ScoreboardFlare E0 FillFlare_Mat 0.75×0.5,
  colour 0.1875, alpha fading 1 → 0 over 0–4000 uu.

#### 16.3 Behaviour [I] (UE3 lens-flare model; native per-element code not located in this build)

**Rendering**
- Each enabled element is a camera-facing quad at the source's screen position (RayDistance 0).
- Drawn additively in the Foreground DPG, so after the shafts and before the Uber pass. It is therefore bloomed and
  tone-mapped (PP-14).

**Visibility**
- From an occlusion query of the fixed relative bounding box.
- The visible-pixel fraction maps through ScreenPercentageMap to the "LensFlare Occlusion" intensity.
- Engine defaults [A]: MaxOcclusionPixelsFraction 0.1, MaxTrackedOcclusionIncrement 0.1, TrackedOcclusionStepSize 0.1.
  These suggest a tracked visible fraction that changes by at most 0.1 per step.

**Cone (SpiralRainbow)**
- Full intensity when the camera is within 100° of the source's facing, fading to 0 at 120°.
- Sources face +X/−X by yaw: yaw 32768 for the −Y row, 0 for the +Y row.

**Size and intensity versus screen position**
- Size is a fraction of the screen [I].
- No radial-distance curve is non-constant on a visible element, so there is no intensity change with screen
  position beyond occlusion and cone.

#### 16.4 Derived forms for the textures (local only; shippable as descriptions)

- **FillFlare:** a soft radial glow; use a smooth radial falloff (e.g. (1 − r²)² on the unit disk).
- **Corona_Sun01_D:** a six-spike hexagonal star; use a rule-built 6-ray star with a soft core.
- **DirtyLens_D:** a screen-space dust mask; use low-contrast procedural noise.
- **SpiralRainbowFlare_MIC:** a rainbow spiral sprite; use a hue ring with an angular twist.
- Texture statistics were not measured (open).

### 17. Reflection-cube capture blur chain (GrassCube), exact

#### 17.1 Pipeline [N][A]

**Capture loop** (`0x1408628c0`, FSceneCaptureProxyCubeMap::Render)
- Builds a 90° view per face (projection 1/tan(45°)) and runs the full scene renderer with the component's
  post-process chain.
- Copies each face to the cube.
- Then optionally runs one cube post pass, selected by proxy+0xa4 = component `PostMethod` (`0x1408678c0`):
  - 1 = `FCubemapDesaturatePostPixelShader` (`0x140419330`);
  - 2 = `FCubemapSeamlessPostPixelShader` (`0x1404197e0`): a 1024-sample GGX prefilter with roughness
    CubemapSeamlessRoughness (default 0.17) and output pow(·, 1/2.2).
- GrassCube's component sets no PostMethod (enum default SceneCapPost_None) [A], so **no seamless or desaturate pass**.

**The chain** (`Cubemap_Blur64_PP` = DOFAndBloomEffect)
- Own values: BlurKernelSize 64, MinBlurAmount 1.
- Class defaults: BloomThreshold 1, BloomScale 1, BlurBloomKernelSize 16.
- The render (`0x1404526a0`):
  1. half-res box downsample of the face;
  2. DOF gather into quarter res: (c̄·b, b)/4 with b ≡ 1;
  3. Gaussian blur with r = BlurKernelSize/4 · ViewWidth/1280 = **3.2** (`0x140a71120`; ViewWidth 256);
  4. a bloom gather + blur (r = 16/4·0.2 = 0.8) into another buffer;
  5. `FDOFAndBloomBlendPixelShader`: out = (S·w + 4·D.rgb)/max(4·D.a + w, 0.001), with w = 1 − b = 0, i.e.
     **D.rgb/D.a**.
- The blend samples only the DOF buffer [M]. That is why bloom does not reach the cube [I, medium].

**Kernel**
- r = 3.2 gives K = 4: a separable discrete Gaussian, weights ∝ exp(−i²/6.4), i = −4…4.
- Bilinear pair offsets −3.2509, −1.3849, 0.4610, 2.3141, 4.0; weights 0.0738, 0.3135, 0.4183, 0.1759, 0.0185.
- Taps outside the face read 0 in both colour and weight, so the D.rgb/D.a normalisation removes the edge darkening.

**Store** (`0x140a6fc30`, FinishRenderViewTarget with `FGammaCorrectionPixelShader`)
- out = pow(sat(c), 1/DisplayGamma). An A8R8G8B8 target that is not forced linear has gamma 2.2 [I].
- The texture defaults to SRGB = True, so sampling decodes ≈ back to linear [I].
- Net: ≈ min(c, 1) with gamma-space 8-bit quantisation. It is slightly lifted in the deep darks by the sRGB/2.2
  mismatch: 0.001 → 0.0034, 0.01 → 0.014, 0.18 → 0.178.

#### 17.2 Recipe (answers RV-129)

1. Render each face at 256² in linear HDR, with the SUR-33 hotspots and fog.
2. Box-downsample to 64² (4×4 mean).
3. Separable 9-tap Gaussian, σ² = 3.2 texels², **renormalised inside the face**: no wrap across faces, no black
   border.
4. Bilinear upsample to 256².
5. Clamp to [0, 1] and store 8-bit (gamma 1/2.2 encode, sRGB decode on read).
6. Repeat the capture ≈ 6 times at 3 Hz (SUR-36). Each capture reads the previous cube.

- The blur is per face and **before** quantisation.
- Effective σ ≈ 7.2 face pixels: about 2.9° at a face centre, 1.5° near the face edges.
- SUR-32's "64-px full-frame blur" should read "a σ ≈ 7 px per-face Gaussian".

### 18. Frame order, corrected [N] (`0x140a79750` for SDPG_World)

1. Opaque base pass and lights.
2. Lighting-only World-DPG effects: **SSAO**.
3. Height fog (`0x140a2f620`).
4. `0x140453070` (scene-colour work, not identified).
5. World translucency (`0x140aaac50`).
6. `0x140a7b120` (a per-light pass, not identified).
7. **Light shafts** (`0x140a5c6c0`, World DPG only).
8. **Velocity buffer** (`0x140aac640`, if MotionBlur).
9. Non-lighting-only World-DPG effects (none).
10. Foreground DPG: **lens flares**.
11. PostProcess DPG: the Uber pass, with the half-res motion-blur/DOF composite and the bloom.
12. AA.
13. HUD.

Consequences:
- Translucent surfaces (particles, glass, boost) receive no AO.
- They are covered by the shaft darkening.
- They write no velocities: they get only camera motion blur through the static path.

### 19. three.js passes (additions to part 1 §10)

**Motion blur** (inside the half-res pass, part 1 step 3)
- **Velocity target:** RG8 or RGBA8 at full resolution, cleared to 0.
  - Draw cars, wheels and ball with a shader that outputs 0.5·clampLen1(V) + 0.5, with
    V = (Δndc.x, −Δndc.y/aspect)·0.5·A·TS/k = (Δndc.x·20, −Δndc.y·20/aspect), where
    Δndc = ndc_now − ndc_prev of the same surface point (object and camera motion), as in §13.2.
  - Use the previous model and camera matrices per object.
- **Static pixels:** reconstruct the previous NDC from depth with prevViewProj.
  - Reset prevViewProj on cuts: 90° or 10000 uu.
- **Half-res shader:** §13.3 verbatim. Keep the 8-bit-encoded comparison for the rejection.

**SSAO**
- **Half-res pass 1:** (min, max) depth.
- **Pass 2:** §14.2.
- **Passes 3 and 4:** the 4-tap filter.
- **Apply:** multiply the scene colour after opaque rendering and before the fog and transparent passes.
  In three.js:
  - render opaque to a target;
  - apply AO with a full-screen multiply;
  - then render transparent objects into the same target.

**Light shafts**
- Three quarter-res/full-res passes (§15.2), after transparent objects and before lens flares.
- Skip when the sun's clip w < 0.
- Use the same depth cap as the rest of the clone (near·1000) so that the effect matches.

**Lens flares**
- 14 additive sprites on a foreground layer, drawn before the final pass.
- Fade by the visible fraction of a small box (depth-tested query or a few depth taps).

**GrassCube:** §17.2.

### 20. Updates to part 1

- **PP-11** becomes PP-21..23: High confidence on the shader and constants; Medium on TS (unwritten global) and the
  primitive list.
- **PP-12** becomes PP-24..26: High.
- **PP-13** becomes PP-27..29:
  - High on the passes and the formulas;
  - the visible outcome depends on the near plane (Medium).
  - The constant mapping in PP-13's open question is now [N].
- **PP-14** becomes PP-30: Medium on the data. The per-element native mapping is still open.
- **PP-16:**
  - Weather default True (VideoSettingsSave_TA).
  - The AA default is Off [A][S].
  - The ini chain is read (PP-32).
- **PP-17** order replaced by §18: the shafts come after translucency, and the velocity pass after the shafts.
- **Open questions 1, 2, 3, 5 and 6** of part 1 §12 are answered by PP-21..29 and PP-32. Lens flares (PP-14) are
  partly answered.

### 21. Confidence and open questions

| Item | Confidence |
|---|---|
| PP-21, PP-22 (shader math, tables, scales) | High |
| TS = 2 | Medium-high (no writer of `DAT_1424b48e4` in .text; an indirect writer cannot be excluded) |
| PP-23 | High |
| PP-24, PP-25, PP-26 | High (shader + native constants + package values) |
| PP-27, PP-28 | High |
| PP-29 | Medium (hinges on near plane 10) |
| PP-30 | Medium for data and visibility; Low for the per-element screen math |
| PP-31 | High on order, per-face, kernel and no-seamless; Medium on bloom absent and the store gamma |
| PP-32 | High that the ini is read; Medium-high on the AA default (UpdateAAType has an undecoded read from the video save) |

**Open**
1. **Near plane:** `GNearClippingPlane` 10 unless `[Engine.Engine] NearClipPlane` is set. No Engine.ini ships;
   check that no camera code changes it. This decides PP-29 and the fog cap (FOG1).
2. **Lens-flare native per-element code:**
   - not found;
   - leads: the vertex factory type at `0x1424b7f10`, a GetType stub near `0x140b45b50`, and natives around
     `0x140679970`;
   - open points: Size units, the ScreenPercentageMap input, the cone math, and the SpiralRainbow MIC shader.
3. **Bloom in the DOFAndBloom capture chain:**
   - the blend shader has no bloom input, but the bloom buffers are filled;
   - a GPU capture of one cube face would settle it.
4. **GrassCube gamma:** whether the A8R8G8B8 cube is stored with gamma 1/2.2 and sampled through an sRGB view
   (`FTextureRenderTargetCubeResource` flags not read).
5. **Velocity primitive list:** what the proxy flag +0x90 bit 0x20 and `0x140aa80d0` mean exactly; which RL
   components set MotionBlurInstanceScale (all 1 by class default).
6. **Unidentified render stages:** `0x140453070` and `0x140a7b120` in §18.
7. **Live checks:**
   - Toggle Light Shafts while facing −X (expect up to 25 % brighter centre with it off).
   - Pan the camera quickly and measure the blur length (≈ 0.5 × per-frame motion, ≤ 24 px at 1920).
   - Under a car at ground contact, expect AO 0.375 only in creases.

### Appendix A: native addresses (live 2026-10-06)

| What | VA |
|---|---|
| MB params bind / Set | 0x1405a1650 / 0x1405a0ab0 |
| Uber proxy RequiresVelocities | 0x1405c1320 |
| Scene renderer view init (camera cut, MotionBlurTimeScale) | 0x140a721b0 (store 0x140a72d15) |
| TS gate global (never written) | 0x1424b48e4 |
| Velocity PS SetMesh (IndividualVelocityScale) | 0x140aaeb30 |
| Velocity pass | 0x140aac640 |
| Velocity buffer allocation (RGBA8, gated by MotionBlur) | 0x140a89e60 |
| FullMotionBlur getter (console override 0x1422a5030) | 0x140a807b0 |
| AO proxy ctor / Render | 0x140a108a0 / 0x140a2edc0 |
| AO occlusion draw (LowQ FALSE,TRUE) / pass driver | 0x140a39210 / 0x140a2fa80 |
| AO params bind | 0x1409f2d80, 0x140a0cf30 |
| AO filter / filter params | 0x140a19f60 / 0x140a3c380 |
| AO apply / blend state | 0x140a0c7a0 / 0x140a1c670 |
| AO downsample depth | 0x140a109c0 |
| AO buffer factor set | 0x140a96f50 |
| Post-process dispatcher (DPG, bAffectLightingOnly) | 0x140a7abf0 |
| DPG render tail (fog, translucency, shafts, velocities) | 0x140a79750 |
| Light shafts render / blur passes / params | 0x140a5c6c0 / 0x140a4d600 / 0x140a61cf0 |
| Light shafts bind | 0x140a4dc30 |
| Shaft apply blend | 0x140a1bf20 |
| DOFAndBloom proxy Render | 0x1404526a0 |
| Gather driver / blur driver | 0x140453810 / 0x140a71120 |
| Cube capture render / proxy ctor | 0x1408628c0 / 0x1408678c0 |
| Cube desaturate / seamless passes | 0x140419330 / 0x1404197e0 |
| FinishRenderViewTarget (gamma copy) | 0x140a6fc30 |
| FConfigFile::Read guard | 0x1402f3650 |
| SystemSettings loader (BasedOn) | 0x140571ec0 |
| Ini paths | 0x14039da80 |
| GNearClippingPlane (10.0) / NearClipPlane read | 0x142260448 / 0x1406b2c80 |
| Lens flare VF type | 0x1424b7f10 |

**Shader blobs** (GlobalShaderCache-PC-D3D-SM5.bin offset):
- FUberHalfResPixelShader1010 1996073; FUberHalfResPixelShader1011 1989501.
- TAmbientOcclusionPixelShaderFLowQualityAOFALSETRUE 1934536; TEdgePreservingFilterPixelShader 1931710.
- TAOApplyPixelShader<AOApply_Normal> 1928977; TDownsampleDepthPixelShader 1974619.
- TDownsampleLightShaftsPixelShader<LS_Directional> 1854527; FBlurLightShaftsPixelShader 1852759.
- FApplyLightShaftsPixelShader 1850602.
- FDOFAndBloomBlendPixelShader 2513750; FGammaCorrectionPixelShader 1808751.
- FCubemapSeamlessPostPixelShader 2577885.

### Appendix B: local-only files (game-derived; git-ignored workspace)

- `out/bsim/agents/PP2/gsc/*.txt`: listings with the fixed decoder (ao, lightshafts, mb, cubemap, dofbloom,
  velocity_*).
- `out/bsim/agents/PP2/dec/*`: decompiles. `dis_*.txt`, `raw_rv.txt`: disassembly.
- `out/bsim/agents/PP2/lf_stadium.json`, `lf_stadium.txt`: lens-flare templates and placements.
- `out/bsim/agents/PP2/rl-live`: the private Ghidra copy.
- Tools:
  - `tools/dxbc.py` (fixed copy of AV0's);
  - `tools/gsc_dump.py`, `tools/gsc_tail.py`, `tools/msc_dump.py`, `tools/rd.py`, `tools/ripscan.py`,
    `tools/dumpobj.py`, `tools/lf_summary.py`;
  - Ghidra scripts `gs/PPRange.java`, `gs/PPRaw.java`, `gs/PPStoreAny.java` (plus PP1's copies).
