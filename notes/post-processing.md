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
  - a goal-replay fade to black alpha 1/255 over 0.5 s, then back (invisible).
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
- Nodes above 0.8 are > 1 before storage. Whether they clip at the LUT (8-bit target) or at the back buffer gives the same visible result.

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
  - fade towards (0,0,0, α = 1/255) over 0.5 s at replay start, and back to 0 over 0.5 s at the end;
  - darkening ≤ 0.4 %, effectively invisible;
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
| PP-11 | Low (constants not decoded) |
| PP-12, PP-13 | Medium (parameters [A]; shader constant mapping [I]) |
| PP-17 | Medium |

**Open questions**
1. Motion-blur constants: cb15, cb25 and the cb27–45 sample tables in `FUberHalfResPixelShader1010`, set natively in `0x14059ff10`'s path. Not decoded.
2. SSAO shader formula (TAmbientOcclusionPixelShaderFLowQualityAO) and the blend state; only the parameters are known.
3. Light-shaft constant mapping:
   - cb19.x/y/z/w, cb20, cb21, cb27 → OcclusionDepthRange, BloomScale, pass index, OcclusionMaskDarkness, Tint, threshold;
   - number of blur passes;
   - exact insertion point relative to translucency.
4. LUT render-target format (8-bit vs float): ≤ 0.0046 difference.
5. Whether `*SystemSettings.ini` are read (config IO). The defaults stated here assume they are.
6. The AA option's true out-of-box default (list default 0 = Off).
7. **Suggested live checks** (live session, offline game):
   - A screenshot of the sky and far stands should look blurred (60 % far DOF) compared with the arena.
   - A grey or white object should clip at linear ≈ 0.77.
   - Toggling the Depth of Field option should visibly sharpen the whole arena (the 25 % MinBlur softening).

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
