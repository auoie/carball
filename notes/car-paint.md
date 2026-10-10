# Car paint and materials: spec (static session, 2026-10-08)

Live build (2026-10-06). Tags:
- [S] script; [A] archetype or defaults; [N] native (live addresses); [I] inferred;
- [M] compiled shader: the body's D3D11 pixel shader, disassembled from RefShaderCache-PC-D3D-SM5.upk.

**Shader cache: approved, local only.** The cache is not encrypted: its 41 chunks are Oodle Mermaid data.
- **The decoder:** out/bsim/agents/AV0/oodle_mermaid.c is a C port of the Mermaid path that AV0 wrote after reading a
  downloaded copy of the GPLv3 ooz decoder. PNT1's build is out/bsim/agents/PNT1/tools/oodle_mermaid_av0.so; the
  unpacked cache is out/bsim/agents/PNT1/shadercache/RefShaderCache_plain.upk (2.59 GB).
- **History:** the permission system first refused to let AV0 compile it; PNT1 then compiled and ran it. The user
  approved the decoder and these results on 2026-10-08.
- **Conditions:**
  - The decoder, its build and the unpacked cache are local and git-ignored. Never commit them, copy them into
    tracked paths (out/bsim/scripts/ included) or ship them.
  - Shader-derived results enter the client as values and formulas only.

**Sub-agent files**, local in out/bsim/agents/PNT1/:
- notes.txt (§5 has the full per-pixel model);
- shaders/bodypaint_gpuskin_A.asm.txt and shaders/chassis_gpuskin.asm.txt;
- palettes.json (every palette, all entries) and product_paints.txt;
- decomp/;
- tools/ (shader-cache unpack, static-switch → shader-map matching, uniform sets, DXBC disassembly).

**Summary.**
- **The paint is a mask, not a multiply.** In the team area the body albedo is the team colour itself, raised to the
  power 2.2 (linear), × 0.734 for the default Glossy finish.
- **Trims** are 0.12 grey (linear) under a rim-light factor.
- **Windows** are black with a strong reflection.
- **The body normal map is not used.**
- **Lighting** is RL's own curve-table model; it maps well enough to a MeshPhysicalMaterial with clearcoat.
- **Default colours:**
  - blue: palette entry BlueTeamV3[35] = (0.0495, 0.535425, 0.99) → linear (0.001343, 0.253010, 0.978132);
  - orange: OrangeTeamV3[33] = (0.99, 0.4884, 0.0495) → linear (0.978132, 0.206684, 0.001343).
  - Both are verified, gamma included.
- **Local renders:** team-coloured Fennec GLBs are exported locally, git-ignored, at
  out/bsim/assets_local/fennec/fennec_body_painted_{blue,orange}.glb.

| # | What | Game | Implement |
|---|---|---|---|
| PNT-1 | Material chain | Body_Grain_SK, slot 1 = MIC_Body_Grain (parent Startup.upk Vehicle_Parent_Materials.Body_Paintable_Mat, MLM_Custom); slot 0 = MIC_Chassis_Grain (parent MAT_Chassis_Grain).<br>Plain Fennec static switches:<br>• **on:** PaintMaskInRGB, UsePaintedSkin, TrimPaintable, Rubber, CurvaturePack, Glass, CarParts, Sparkle, UseDiffuseTexture, UseDetailNormals;<br>• **off:** UseNormalMap, UseColorLookup, Emissive, SharpMasks, VertexColorMasks, Use_UV2, PurePaint, PaintMask_MaskedByAlpha [A] | One masked paint material for the body; **don't** use Body_Grain_BodyNormalMap (UseNormalMap off; the parent has no BodyNormalMap parameter) |
| PNT-2 | Masks | Skin = Body_Grain_BlankSkin:<br>• **R** = team-colour area;<br>• **G** = painted-decal area (PaintColor);<br>• **B** = windows;<br>• **A** = accent/decal pattern (CustomColor, finish F2; 0 on the plain Fennec).<br>Curvature.G = trim area (TrimColor). Body_Grain_D RGB matters only outside these; its alpha is AO [M] | out/bsim/assets_local/fennec/textures/Body_Grain_PaintRegions.png packs R paint, G trim, B glass, A accent |
| PNT-3 | Team colour source | CarMeshComponentBase_TA.GetTeamColor checks, in order: override, forced body/skin colour, logo, club colours, then the team's CarColorSet.GetColor(TeamColorID, else DefaultId) [S].<br>• Team0 → CarColors.BlueTeamV3 (10 hues × 7 values, DefaultId 35); Team1 → OrangeTeamV3 (DefaultId 33) [A].<br>• ColorPalette_X.GetColor (0x140df4080): an out-of-range id falls back to DefaultId, else (0, 0, 0, 0) [N].<br>• Team_TA.GetCarColorSet 0x140e72f90 [N].<br>• Default loadout TeamColorID 35/33 [A] | Blue (0.0495, 0.535425, 0.99) (sRGB-looking #0D89FC); orange (0.99, 0.4884, 0.0495) (#FC7D0D). Both palettes in palettes.json |
| PNT-4 | Gamma | SetMaterialColorParams: material TeamColor/CustomColor = palette^**2.2** (GetCorrectedPaintColor); skipped only for forced colours on SkinType 1 [S]. TeamColorFull (an HSV-normalised variant) exists but the body doesn't use it [S][M]. The MIC's stored defaults are always overwritten at runtime | **Linear TeamColor: blue (0.001343, 0.253010, 0.978132), orange (0.978132, 0.206684, 0.001343)** (verified); set with `color.setRGB(r, g, b, LinearSRGBColorSpace)` (≈ #048AFD / #FD7D04 on screen) |
| PNT-5 | Accent | GetCustomColor → GameData_TA.GetCarCustomColorSet (0x140e8aaa0) → CarColors.Accent (15 × 7). Default CustomColorID 0 = (0.9, 0.9, 0.9) → linear 0.79311 [A][N][I]. Visible only where Skin.A > 0 (decals) | Ignore for the plain Fennec |
| PNT-6 | Combine (albedo) | Pixel shader (base pass with SH light and sky light) [M]:<br>• P = lerp(lerp(TeamColor, CustomColor, mixT), PaintColor, s.g), mixT = s.a + s.r·Pearl·(1 − 2s.a)·rimFresnel;<br>• albedo = lerp(Diffuse.rgb, (1 − s.b)·P, s.r);<br>• albedo = lerp(albedo, trimK·TrimColor.rgb, Curv.g);<br>• × shade (**Glossy 0.734**, Matte 0.61; trim 1).<br>AO = Diffuse.a (identity curve for Glossy) | Paint area = TeamColor (not Diffuse × TeamColor); bake × 0.734 for Glossy |
| PNT-7 | Trim | TrimColor (0.12, 0.12, 0.12, A = 1); alpha picks the type: 1 rubber, 0 metal [A].<br>• **Rubber:** trimK = 0.25·NdV⁴ + (1 − NdV)⁵ + 0.5 (0.75 facing, 1.5 grazing).<br>• **Metal:** trimK = min((1 − NdV)⁵ + 0.1, 1) + min(2·NdV¹⁵, 1.5) [M].<br>**Painted bodies** write the paint into TrimColor (PaintParameterName 'TrimColor', bPaintBody; colour = PaintDB.Paints[id].Colors[Primary]; Black → 0.01; metal paints have A = 0, giving metallic trims) [A][S] | Trim albedo ≈ 0.09 linear (sRGB 84). The Body_Grain_D value there (0.031 linear) is **not** what the game shows. Paint table: product_paints.txt |
| PNT-8 | Windows | Skin.B: albedo 0; light-curve rows + 64; Spec 8; ENV 0.125; plus the GrassCube (cube render target) reflection [M] | Black base, very glossy, environment reflection |
| PNT-9 | Finishes | ProductAsset_PaintFinish_TA sets prefix F1 (TeamFinish, primary) or F2 (CustomFinish, accent) parameters: Type; ControlA = (SpecTint, RimTint + Detail, DiffuseDetail, SpecDetail); ControlB = (Spec, ENV, Sparkle, Pearl); DetailNormal (uv × 4) [A][S]. Default finish (product 270, PaintFinish_Default) = **Glossy**: Type 0, A (0.25, 0.25, 0, 0), B (2, 0.25, 0, 0).<br>Others:<br>• Matte: Type 1, A (.25, .25, .5, .25), B (.25, .03125, 0, 0);<br>• Metallic: Type 2, A (.75, .5, .0625, .0625), B (5, .5, 32, 0);<br>• Pearlescent: Type 0, B (5, .5, 32, 1);<br>• Plastic: Type 3, A (.25, .125, 0, 0), B (.5, .25, 0, 0).<br>Light-curve row = Type·4 (+ glass offset) [M] | PBR approximations:<br>• **Glossy:** roughness ≈ 0.3 + clearcoat (roughness 0.06), shade 0.734.<br>• **Matte:** roughness ≈ 0.8, shade 0.61 (→ 0.89 at grazing).<br>• **Metallic:** metalness ≈ 0.6, roughness ≈ 0.25.<br>• **Plastic:** roughness ≈ 0.5, wrapped diffuse.<br>• **Pearlescent:** hue moves toward the accent at grazing angles |
| PNT-10 | Lighting model | Output = unlit·(Ambient + SH(n) + Sky upper/lower) + lit·LightColor [M].<br>• lit = diffuse curve (half-Lambert input) × (albedo·shade + rim) + (Spec·spec curve(N·H²) + reflection) × specColor.<br>• Reflection = ENV·env curve (ENVPack R sharp / G blurred, chosen by the rim curve A) + sparkle (ENVPack.A).<br>• Curves = LightFalloffArray rows.<br>• **Glossy fit:** Lambert diffuse, highlight ≈ (N·H)^72.<br>• Matte ^19 × 0.58, Metallic ^78 with env 0.37, Plastic ^24, trim ^13 with diffuse ~ (N·L)^1.5 <br>**In matches (2026-10-10, PNT-29):** Car_Default has no light environment, so the SH term is 0; lights render as separate passes (sun, sky light, overhead and goal point lights) | Standard three.js lighting is close enough. A faithful port can use the exported Vehicle_LightFalloffArray.png (sample linear) and Vehicle_ENVPack.png (RGB as sRGB); pseudocode in PNT1 notes §5 |
| PNT-11 | Unused on the plain Fennec | BodyNormalMap, FXMasks, Logo/TrimSheet: only through BodyAsset.SkinParameters with a decal. BodyMasks.A (tertiary/carbon) = the parent default with A = 0. ColorLookup (TeamColorScriptedTexture_TA) unused. Chassis TeamColorChassis off [A][M] | Nothing |
| PNT-12 | Chassis | MAT_Chassis_Grain (Phong) [M][A]:<br>• **Albedo** = lerp(Chassis_D, env cube, Masks.R) + edge brightening, × Chassis_N.R.<br>• **Specular** = Masks.R·(N·H)^128.<br>• **Headlights** = Masks.G where u < 0.585: HeadlightColor (0.583, 0.823, 0.978) × 2.5.<br>• **Tail lights** u ≥ 0.585: TailLightColor (3, .448, .448) × 1.33 × (1 + Brake).<br>• **On screen (corrected 2026-10-09):** the light term L = (GradMask + 0.75)·(head + tail·(1 + Brake)) is **squared** and multiplies Chassis_D, blended in by the same square: out = lerp(lit, L²·Chassis_D, L²) + 0.1·mask (chassis asm 119-147). So the headlights read as a clipped near-white core and the tail lights as saturated red (the painted GLB bake shows (255, 26, 0)), not the parameter hue at peak 1. Braking doubles L, which quadruples L² before clipping.<br>• **Boost glow** = BoostGlowColor × 4 × Masks.A × 3·clamp(BoostGlowIntensity, 0, 2); Standard boost sets (3.0, 0.11974, 0) at attach, replacing the MIC default (3, 0.1326, 0) (corrected 2026-10-10, PNT-19). Braking: ×(1 + Brake) is inside L, so ×4 on L² and ×16 on the L⁴ term; the chassis diffuse uses N·H (PNT-22/25) | Metalness = sRGB → linear(PBR.R); roughness ≈ 0.3; AO = N.R; baked emissive map at strength 3.227. Using PBR.B as roughness (A1's guess) is not what the shader does |
| PNT-13 | Other colour paths | Club colours: primary from CarColors.Clubs (15 × 6), accent from Accent. Colour-blind: blue (0, 0.2, 1), orange (1, 0.6, 0). Replays before version 9 convert old palette IDs. Post-game lobby overrides 0.8 / 0.314 grey [S][A] | Optional |
| PNT-14 | Stadium team colours (not car paint) | Playlist TeamColors, else the archetype's DefaultColorList: blue[0] (0.098, 0.451, 1), orange[0] (0.7647, 0.3922, 0.098) [S][A] | The client arena uses #2a7fff / #ff8a1f (`client/src/render/arena.ts:54` and the themes); see notes/arena-visuals.md |
| PNT-15 | Client gap (verified) | `client/src/render/fennec.ts:66` does `mix(diffuse, diffuse·paintColor, skin.r)`. Compared with the game:<br>• the 0.734 Glossy shade is missing;<br>• trims render at 0.031 instead of about 0.09;<br>• no clearcoat-style highlight;<br>• the paint is not the game's linear team colour.<br>Uses fennec_body.glb (its body material includes the normal map the game doesn't use) | **Easiest:** load fennec_body_painted_{blue,orange}.glb instead (KHR_materials_clearcoat and KHR_materials_emissive_strength, both supported by GLTFLoader). **Or recolour at runtime** with PaintRegions (PR): albedo = mix(mix(D_lin, TeamColor, PR.r), 0.75·TrimColor, PR.g) × mix(0.734, 1, PR.g), plus clearcoat 1 masked by PR.r with clearcoatRoughness 0.06, and no normal map |

## Fennec recipe (three.js)
- **Body**, MeshPhysicalMaterial:
  - map = Body_Grain_BaseColor_<team>.png (sRGB, flipY = false), or the runtime recolour in PNT-15;
  - aoMap / roughnessMap / metalnessMap = Body_Grain_ORM_glossy.png (R / G / B);
  - clearcoat 1 with clearcoatMap = PaintRegions (R), clearcoatRoughness 0.06;
  - no normal map, no emissive.
- **Chassis:** map = Chassis_Grain_D; normalMap = Chassis_Grain_N_gl; aoMap / roughnessMap / metalnessMap =
  Chassis_Grain_ORM_pnt; emissiveMap = Chassis_Grain_Emissive_rest, emissive (1, 1, 1), intensity 3.227. Double the tail
  lights while braking.
- **Lenses and wheels:** keep A1's materials.
- **Files** (all local, git-ignored, described in out/bsim/assets_local/fennec/README_PAINT.txt):
  - fennec_body_painted_{blue,orange}.glb (checked: three r186 GLTFLoader parses both, 44266 vertices, body as
    MeshPhysicalMaterial with clearcoat 1);
  - in textures/: Body_Grain_BaseColor_{blue,orange}, Body_Grain_PaintRegions, Body_Grain_ORM_glossy,
    Chassis_Grain_ORM_pnt, Chassis_Grain_Emissive_rest, Vehicle_LightFalloffArray, Vehicle_ENVPack.

## Open
- **Per-map light environment** (light colour, SH, sky upper/lower, ambient) and how GrassCube is captured: see
  notes/arena-visuals.md once it lands.
- **Approximations:** the roughness and metalness values approximate the curve model.
- **Not analysed:** the lens (MAT_PlasticLens_VertColor) and wheel (Wheel_Master_Mat, OEM_RGB mask) materials.
- **Decals:** channel meanings were checked on one decal (Aloha); the accent finish's detail-normal look is not baked.
- **Inferred:** GetCarCustomColorSet +0x250 = CustomColorSet relies on a 0x30 layout shift.

---

## Remaining look: windows, lights, glow, wheels, lighting and shadows (PNT-16..33, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent CAR2; the static session re-checked the brake event
(FXActor_Car_TA.SetBraking sets 'Brake' to 0 or 1 on the brake-light material, TA:31314) and the boost-glow colour source.

Extends notes/car-paint.md (PNT-1..15), continuing at PNT-16. Live build (2026-10-06); every address is from the live
project (copy in out/bsim/agents/CAR2/rl-live). Tags:
- [A] package data; [S] script (TA:<line> = out/bsim/work/tagame_live_all.txt); [N] native (live addresses);
- [M] compiled shader (RefShaderCache, read with AV0/shadercache.py); [I] inferred.

All colours and formulas are **linear**, before the global tone map (notes/post-processing.md). World frame = UE (X
forward, Y right, Z up); three.js direction = (X, Z, Y) as in `coords.ts`. `sat` = clamp to [0, 1]; NdV, NdL, NdH are
dot products of unit vectors. LFA(x, row) = Vehicle_LightFalloffArray (1024 × 128, linear) sampled at
u = x, v = (row + 0.5)/128, bilinear.

**Local evidence** (all git-ignored, Psyonix-derived, never ship) in out/bsim/agents/CAR2/:
- sc/*.txt: shader listings with the uniform mapping:
  - body.txt (SH base pass) and body_nolm.txt (no-lightmap base pass and point-light pass);
  - chassis.txt, chassis_nolm.txt and chassis_dir.txt (SH base pass, no-lightmap base pass, sun pass);
  - wheel.txt and wheel_dir.txt; lens.txt.
- decomp/b1..b7: Ghidra output and asm, including TickFX 0x140f52b60, the VehicleSim brake 0x140f24270 and PitchTek.
- stadium_lights.txt: every light, sky light and sky-light volume in Stadium_P.
- tex/, tex2/: Swirls_D, GradMask_T and texture flag checks.

Shader ids:

| Material | Pass | Id |
|---|---|---|
| Body | SH base pass | 4abc0ff9… |
| Body | no-lightmap base pass | 403c3afb… |
| Body | point-light pass | 1a405ff5… |
| Chassis | SH base pass | c0a0b318… |
| Chassis | no-lightmap base pass | 56b5090f… |
| Chassis | sun pass | 72eff0a5… |
| Wheel_Master_Mat | high-quality base pass | 34a50985… |
| MAT_PlasticLens_VertColor | base pass | 27dd12f4… |

### Summary
- **Windows** are opaque black. Their whole look is the GrassCube along the world reflection of the geometric normal
  (no normal map), scaled by a glass Fresnel/glint weight w(N·V). That weight is 0.05 head-on, peaks at 1.13 near
  N·V 0.2 and falls to 0.2 below 0.1.
  - The result is lit like the rest of the body: × (ambient + sky light) plus × each light. A hard 2° sun glint sits on
    top.
- **Boost glow** is really a speed glow on the chassis rear. The emissive is (3, 0.120, 0) × 4 × Masks.A × 3·clamp(I, 0, 2).
  - I follows forward speed / 2300 while grounded or boosting, else 0, smoothed at 2/s.
  - The colour comes from the boost product (Standard: orange, team-independent).
- **No tyre or skid marks** (and no jump-blast, demolition or goal decals) on Stadium_P: the PitchTek system is gated
  on WorldInfo.PitchTek, and Stadium_P has none.
- **Brake lights** = VehicleSim.OutputBrake ≠ 0. That is coasting (|throttle| ≤ 0.01), stopped, or throttle against
  motion above 25 uu/s, with at least one wheel in contact and the handbrake not held.
  - The parameter is 'Brake' ∈ {0, 1}: a step, no smoothing.
  - It doubles the tail term inside L, before squaring.
- **No reverse lights.** The headlights are always on.
- **Wheels:** the OEM rim is dark (mean 0.032) with a grey 0.147 ring and is not team-coloured. The tyre is near-black
  with a grey grazing sheen. Both use RL's half-vector "Phong".
- **Lighting:** the car has **no light environment** in a match. It is lit by:
  - the sky light (team-coloured from below near the goals and side walls);
  - the sun;
  - 4 overhead and 2 goal point lights.
- **Shadows:** the car casts a projected, modulated sun shadow (× 0.425).

| # | What | Game | Implement |
|---|---|---|---|
| PNT-16 | Windows: what is sampled | Skin.B = 1, Skin.R = Skin.A = Skin.G = 0, Curv.G = 0, Body_Grain_D.rgb = 0 (window texels: D.rgb mean 0.0004; D.a median 0.98; Curv.R ≈ 0.5) [A].<br>Hence CA = 0 (no detail normal); BodyMasks.A = 0 (no tertiary normal); UseNormalMap off.<br>**n = the interpolated geometric normal.**<br>**Reflection vector:** R = reflect(−V, n) in world space [M].<br>**Cube:** Grass_Textures.GrassCube (t9), sampled **directly along R_world**: no box projection, no offset, no bias. The chassis and lens box-project the same cube; the body does not.<br>**Stylised env term:** e = ENVPack((R_world.xy + 1)/2) (ENVPack RGB sRGB-decoded). The glass rim curve has A = 0, so the sharp R channel is used: envC = LFA(e.r, row 96).B. That is a posterised curve:<br>• ≈ 0.07–0.09 for e 0.03–0.36;<br>• 0.18–0.30 for 0.37–0.72;<br>• 0.48–0.60 for 0.75–0.90;<br>• 0.82 at 0.94;<br>• 1 at ≥ 0.97.<br>Mean over the ENVPack disc **0.103** (p10 0.002, p50 0.067, p90 0.29) [M][A] | Own arena cube captured at (0, 0, 928) (three (0, 928, 0)), LDR, heavily blurred (SUR-32..36). Look it up along the world reflection of the vertex normal; no normal map. ENVPack is texture-only: in builds use envC = 0.103 |
| PNT-17 | Windows: glass curves (rows + 64) | x = NdV (geometric). Rim row 66 = rows 98:<br>• R = 0.996 for x < 0.098, else 0.502;<br>• G (rim) ≈ 0.5→1.0 over x 0–0.03, 1.0 to 0.098, then 0;<br>• B (Fresnel) = 0.963, 0.745, 0.614, 0.510, 0.418, 0.339, 0.271, 0.214, 0.169, 0.133, 0.102, 0.076, 0.055, 0.039, 0.027, 0.020, 0.012 at x = 0, 1/32 … 16/32, then 0 (fit max(0.963·e^(−6.08x) − 0.039, 0), max error 0.045).<br>Spec row 96 G = 0 until (N·H)² > 0.9985, 1 at 1.<br>Diffuse row 64 R ≈ 0 for N·L ≤ 0, 0.10 at 0.25, 0.25 at 0.5, 0.47 at 0.75, 0.98 at 1.<br>AO row 64 A ≈ identity [A][M].<br>**Fresnel:** fres = (sat(2·(rim.r − 0.5)) + rim.b)·6 + 0.3 → 12.0 at grazing, 3.3 at x 0.1, 1.34 at 0.25, 0.39 at 0.5, 0.32 for x ≥ 0.6.<br>**Glint band:** G(x) = sat(12·(x − 0.09375))·(1.25 − x²) [M] | Use the closed forms, or the table in PNT-18 |
| PNT-18 | Windows: full formula and opacity | Body_Paintable_Mat is **opaque** (no BlendMode, so BLEND_Opaque; not two-sided) [A]. Values: spec = 8, env = 0.125, sparkle 0, specColor = 0.5, albedo 0, shade irrelevant [M].<br>**Terms:**<br>• refl = Cube(R)·(3·0.125·envC + G(x))·fres + 0.125·envC;<br>• diffuseC = 0.5·(1 − Curv.R)·rim.g (a thin grazing rim only);<br>• ao = sat(LFA(D.a, row 64).A + depth/4096) (≈ 0.97, → 1 at 4096 uu);<br>• unlit = ao·(0.5·refl + diffuseC);<br>• lit = sat(ao·(LFA((N·L + 1)/2, 64).R·diffuseC + 0.5·(8·LFA((N·H)², 96).G + refl))).<br>**Out** = unlit·(Ambient + SH + SkyFactor·(Upper·((1 + n·up)/2)² + Lower·((1 − n·up)/2)²)) + Σ_lights lit·LightColor·atten·shadow [M].<br>**No tint** on the cube (specColor is grey). The warm sky and sun tint it through the lighting.<br>**Weight on the cube**, w(x) = 0.5·(0.375·0.103 + G)·fres:<br>• 0.232 at 0, 0.198 at 0.05, 0.206 at 0.10;<br>• 0.63 at 0.12, 1.07 at 0.15, **1.13 at 0.20**, 0.82 at 0.25, 0.61 at 0.30;<br>• 0.33 at 0.4, 0.205 at 0.5, 0.161 at 0.6, 0.129 at 0.7, 0.105 at 0.8, 0.077 at 0.9, **0.047 at 1.0**.<br>Plus a constant 0.0064.<br>**Sun glint:** 4·specCurve saturates lit, so the window shows the full sun colour where θ_H ≤ 2.0° (N·H ≥ 0.99939), with a ramp from about 2.2° to 1.3° [M] | Custom material (ShaderMaterial or onBeforeCompile on MeshBasicMaterial), opaque, black base:<br>out = Cube(R)·w(NdV)·E_sky(n) + min(Cube(R)·w, 1)·Sun·shadow + Sun·shadow·step(N·H ≥ 0.99939).<br>E_sky (PNT-29) is the hemisphere sky term; add the point lights like the sun. Skip diffuseC and AO, or keep diffuseC for the grazing rim |
| PNT-19 | Chassis "boost" glow | **Emissive** (added after lighting, not lit) = BoostGlowColor·BoostGlowBrightness·Masks.A·3·clamp(BoostGlowIntensity, 0, 2) [M; chassis cb0[58], [61].x, [61].w].<br>**Values:**<br>• BoostGlowBrightness = 4.0 (MIC_Chassis_Grain);<br>• BoostGlowColor = the boost product's CarBoostGlowColor, set on the chassis MIC at attach (FXActor_Boost_TA.SetAttachmentActor → HandleUpdatedPaintSettings, TA:30870-30871, 31109-31113) [S].<br>• **Standard boost: (3.0, 0.11974, 0.0)** [A Boost_Standard.FX.FXActor], replacing the MIC default (3, 0.1326, 0). **Not team-coloured**; painted boosts use Paint.Colors[0] (ApplyPaint TA:31100-31104).<br>**Intensity**, every rendered frame [N TickFX 0x140f52b60, 0x140f53166-0x140f531e3]:<br>• I += min(1, dt·BoostGlowRate)·(target − I), with BoostGlowRate = 2.0 (class default), so τ ≈ 0.5 s, the same in and out;<br>• target = (grounded \|\| CarMesh.bBoosting) ? v_fwd / MaxLinearSpeed : 0;<br>• v_fwd = RBState.LinearVelocity · car forward [N 0x140ef4c80]; MaxLinearSpeed = 2300 (Car_Default; RBActor+0x560, which answers the VT-5 open question);<br>• grounded = wheels in contact ≥ NumWheelsForGrounded 3 [N vfunc 0x140f122e0].<br>So it is a **speed glow** (also without boost on the ground). It is 0 when reversing (clamp) and decays in the air unless boosting; it peaks at 3 at 2300 uu/s.<br>Pushed to BodyAsset.ChassisMaterialIndex (0) and BoostMaterialIndex (−1 on the Fennec, so skipped).<br>**Mask:** Chassis_Grain_PBR **alpha** (raw; alpha is never sRGB-decoded). Covers 0.94 % of the chassis area, at the rear (mesh X ≈ −55, full width), mean 0.524 there [A] | emissiveMap = Masks.A (local), emissive = (3, 0.1197, 0)·12·clamp(I, 0, 2), i.e. **(36, 1.44, 0)·Masks.A at 2300 uu/s**. Drive I with the rule above (frame dt) |
| PNT-20 | Other runtime car material parameters (complete list) | **Native, every frame** [N 0x140f52b60]:<br>• BoostGlowIntensity (PNT-19);<br>• **ForwardSpeed** = grounded ? v_fwd/2300 : 0 on every car-mesh element. No Fennec material reads it (not in the body or chassis parameter sets) [A].<br>**Events and script:**<br>• 'Brake' (PNT-22/23);<br>• BoostGlowColor (PNT-19);<br>• paint (TeamColor/TeamColorFull, CustomColor/CustomColorFull, F1*/F2* finish, SkinParameters; PNT-3..9) on every body element via ApplyPaintSettings, which re-runs on paint changes (TA:18888-18929);<br>• lens DesaturateLenses = 0 (body SkinParameters through the lens attachment's InheritCarSetting) [A].<br>**None on the car:**<br>• **dissolve:** the 'Dissolve' FName (0x1424c5670) is read only by the ball fade 0x140f5c7d0/0x140f5c880 [N];<br>• hit flash, damage, supersonic or team material parameters;<br>• translucency (Ball_TA only).<br>A demolished car is hidden instantly and respawns instantly with SpawnFX sparks (VT-19/20) | Implement BoostGlowIntensity and Brake only. No dissolve or flash on cars |
| PNT-21 | Tyre and skid marks | **None in Soccar on Stadium_P.** Evidence:<br>• Marks would come only from PitchTekDrawingComponent_TA (Car_Default.DefaultPTDComponent, no properties) [A].<br>• Every path returns early when WorldInfo+0xa18 = WorldInfo.**PitchTek** (PitchTekSettings) is None [N]: tick 0x140f4fac0, draw 0x140f548d0, the queue natives 0x140e7c240 (jump blast), 0x140e7c050 (demolition), 0x140e7bf70 (goal).<br>• Stadium_P's WorldInfo has no PitchTek property; the name is absent from its name table, and no Stadium_P material uses MaterialExpressionPitchTekTextureSample [A].<br>**What it would draw** on a map with PitchTekSettings: wheel, car-body, car-position, ball, jump-blast, demolition and goal decals into colour and data render targets. These reset in Countdown.BeginState and PostGoalScored.EndState (TA:3959, 4260).<br>The static "TireMarks" texture in Frame_01_V2_Mat (H-4) is baked wear, not dynamic.<br>**Corrects VT-28/VT-29:** no jump-blast decal on Stadium_P | Nothing. (A PitchTek map would need its own spec) |
| PNT-22 | Brake signal | Native FXActor_Car_TA TickFX, every rendered frame [N 0x140f52b60, 0x140f52c47-0x140f52cde]:<br>• **bDriving:** braking = (VehicleSim.OutputBrake ≠ 0).<br>• **Not driving:** braking = (Input.Throttle == 0) (a car with no driver, e.g. post-match [I]).<br>• On a change it stores bBrake and calls the event **SetBraking** (FName 0x1424c59b8, from "SetBraking" at 0x140ebf922).<br>**OutputBrake**, per physics tick [N VehicleSim 0x140f24270, from the Bullet callback 0x140ecef40]; T = Input.Throttle, v = v_fwd:<br>• **handbrake held:** 0 (powerslide never lights them);<br>• **\|T\| ≤ 0.01:** IdleBrakeFactor 0.15 if \|v\| ≥ StopThreshold 25, else 1.0 (coasting **and** standing still);<br>• **T > 0.01:** OppositeBrakeFactor 1.0 if v < −25, else 0 (BackwardsMode treats it as coasting);<br>• **T < −0.01:** 1.0 if v > 25, else 0 (reversing does not light them);<br>• **no wheel contact:** 0 (off in the air).<br>Not deceleration-based. Remote cars use their replicated throttle [I] | brakeLight = grounded1 && !handbrake && (\|T\| ≤ 0.01 \|\| (T > 0.01 && v < −25) \|\| (T < −0.01 && v > 25)), where grounded1 = at least one wheel in contact. Evaluate per frame from the latest physics state |
| PNT-23 | Brake parameter and shader term | **Parameter:** FXActor_Car_TA.SetBraking (TA:31314-31315): ConditionalCreateMIC(BodyAsset.BrakelightMaterialIndex = 0, the chassis).SetScalarParameterValue('**Brake**', bNewBraking ? 1 : 0) [S].<br>**No smoothing:** a step on the frame of the change; the shader uses clamp(Brake, 0, 1) [M].<br>**Edge case:** MIC_Chassis_Grain stores Brake = **1.0** [A], and the event fires only on changes. A freshly created chassis MIC (spawn, or ApplyPaintSettings → InitMaterials) shows braking until the next on/off transition. At a kickoff the car stands still, so the state is 1 anyway [S][I].<br>**Term** [M], with the masks:<br>• isTail = floor(1.71·u) (u ≥ 0.585);<br>• head = sat(M.G·(1 − isTail)), tail = sat(M.G·isTail);<br>• L = M.G·N.R·[(Grad + 0.75)·(head·2.5·HC + tail·(1 − N.R)·1.33·TC·**(1 + Brake)**) + M.B], with HC = (0.583, 0.823, 0.978), TC = (3, 0.448, 0.448), Grad = GradMask_T.G(92u, 9v) (sRGB, mean 0.356), N = Chassis_Grain_N, M = Chassis_Grain_PBR (RGB sRGB-decoded).<br>**Answer:** yes, ×(1 + Brake) applies to the tail term **before** L is squared; the headlights and M.B are unaffected.<br>**Tail-region means:** L.r 0.80 → 1.53 braking; L² 0.90 → 3.29; L⁴ 1.75 → 23.9 [A stats] | Faithful: the PNT-25 formula with Brake ∈ {0, 1}.<br>Cheap: tail emissive × 4 while braking (L² scale), not × 2 as the Fennec recipe says |
| PNT-24 | Headlights and reverse lights | **Headlights:** always on, static: HeadlightBrightness 2.5 × HeadlightColor; no parameter drives them [A][S].<br>**Reverse lights: none.** The chassis parameters are only HeadlightBrightness, TailLightBrightness, Brake, BoostGlowIntensity, BoostGlowBrightness, HeadlightColor, TailLightColor, BoostGlowColor (TeamColor and ChassisEmissive sit behind switches that are off) [A].<br>**Lenses:** MIC_PlasticLens_VertColor does not take Brake (PNT-28) | Keep the headlights constant |
| PNT-25 | Chassis light region on screen (refines PNT-12) | A = (lerp(D, CubeBox(R), M.R) + (1 − sat(2·NdV))²·(D.r + 0.2))·N.R. CubeBox = GrassCube at P + t·R on the box ±(5000, 7500, 5000) around the world origin [M].<br>Every lighting term i with light E_i and geometric factor f_i becomes lerp(f_i·A, L²·A, L²) = **A·(f_i·(1 − L²) + L⁴)** [M]. The terms are:<br>• sky upper/lower: f = ((1 ± n·up)/2)²;<br>• sun and point lights: f = sat(N·H) (the chassis diffuse uses **N·H**, not N·L), × shadow·atten.<br>Ambient is not lerped. **Emissive** = PNT-19 + 0.1·M.G.<br>**Brightness:** where L ≥ 1 the output ≈ A·L⁴·ΣE_i: about 3.4 for a tail at rest and about 46 braking (red channel, sun + sky). The headlights are ≈ (15, 57, 53), so they clip white.<br>**Specular** = M.R·sat(N·H)^128·LightColor | three.js: emissive ≈ A·L⁴·E_sum, with E_sum = sum of the sky + sun colours at the car (≈ (3.4, 3.6, 1.8) unshadowed). Or keep the PNT1 baked emissive and scale it per PNT-23 |
| PNT-26 | Wheels: rim | Wheel_OEM_MIC → Wheel_Master_Mat (UE Phong; switches RGBMasks, UseCustomColor, ColorIsReflective on; UseTireColor, PaintMasksSpec, Sparkles off) [A][M].<br>**Parameters:** CustomColor (0.5027, 0.5027, 0.5027, **A = 1**); RimColor (0.75); ReflectionBrightness 0.36; SpecIntensity 10; SpecPower 40 [A].<br>**Vertex colour R** = tyre mask t (rim 0).<br>**Normal:** OEM_N (swizzled AGB) + 0.1·BrushedMetal_N(v·10, u).<br>**Fake reflection:** r = Swirls_D.R(R_ts.xy·0.05) + 0.36. Swirls_D is G8 (sampled linear); mean **0.89**, range 0.40–1.33.<br>**Diffuse** C_rim = lerp(G·r·CC·(r·D + CC), r·D, R), with D = OEM_D (sRGB), R, G = OEM_RGB (sRGB).<br>• Area means: **0.032** overall; 0.027 on the 80 % R region; **0.147** grey on the 4 % G-only ring; ~0 elsewhere.<br>• The Fresnel K is disabled (lerp(K, 1, CustomColor.A = 1)).<br>**Specular colour** sat(10·D) (mean 0.25), power 40.<br>**Lighting** [M]: base pass C·(Ambient + sky hemisphere); per light C·sat(**N·H**) + spec·sat(N·H)^40, × LightColor·atten·shadow.<br>**Not team-coloured:**<br>• CreateWheelMICs (TA:18950) has no callers;<br>• ApplyPaintSettings only applies the wheel product's attributes (TA:19088), and the OEM has only an inactive PaintSettings;<br>• WHEEL_Star has no InheritCarSetting.<br>So the car's TeamColor or CustomColor never reaches the rims [S][A] | Rim: dark (≈ 0.03 linear) metal with a 0.15 grey ring; MeshPhong-like with specular ≈ 0.25 and shininess 40. With local textures: diffuse = the formula above with r = 0.89 |
| PNT-27 | Wheels: tyre | **Normal:** (0.625·Tn.xy + 0.375·Matte_N(2uv).xy, Tn.z) (Tire_Swarm_Tyr_Normal); Tz = sat(Tn.z) [M].<br>k = (clamp(2·NdV, 0.35, 1)·sat((0.625 − NdV)·1.666))².<br>**Diffuse** = sat(lerp(8·(NdV⁶ + 1/64)·TireD, Tz·RimColor (0.75), k)), with TireD = Tire_Swarm_Tyr_Diffuse (sRGB, area mean **0.005**). So it is near-black: 0.04 facing, a grey sheen of 0.03–0.08 at N·V 0.1–0.5.<br>**Specular** = 4·TireD·Tz·NdV (≈ 0.02), power **6**.<br>Same lighting as the rim [M]. No spin blur or speed parameter in Wheel_Master_Mat [A] | Tyre: black (0.005–0.04) with a grazing grey rim term; weak, broad specular |
| PNT-28 | Headlight and tail-light lenses | Body_Grain_Lenses_SM (body attachment at PAS_Root) uses MAT_PlasticLens_VertColor [A]:<br>• **translucent**, α = 0.5 (o0.w) [A BlendMode][M];<br>• vertex colour VC: tails (1, 0, 0), heads (1, 1, 1).<br>**Colour** C = VC·(CubeBox(R)·((1 − NdV)² + 0.25) + (1 − NdV)⁴) + 0.01 (Normal = Blank_N, so the geometric normal; DesaturateLenses 0).<br>out = C·(1 + Ambient + SkyFactor·sky hemisphere) (emissive and diffuse are both C) [M].<br>The Brake parameter does not reach the lens; the brightening is in the chassis underneath | Translucent (opacity 0.5) VC-tinted reflector with self-emission C |
| PNT-29 | How the car is lit in Stadium_P (cross-check of PNT-10 and AV-17) | **No light environment in matches:**<br>• Car_Default and Default__Car_TA have no LightEnvironment component; LightEnvironment_TA is referenced nowhere but its own class;<br>• the garage CarPreviewActor_TA attaches one (TA:22832-22836) [A][S].<br>So the match path is the **no-lightmap base pass + sky light** plus one additive pass per light [M][I]. PNT-10's SH and "dominant light" terms belong to the garage. In a match SH = 0 and AmbientColor = 0 (as LMP measured for the arena).<br>**Car mesh channels:** Dynamic only (BSP and Static off on Default__Car_TA.DefaultMesh); attachments copy them (TA:18511-18518) [A].<br>**Lights that reach the car:**<br>• **Sun** LC_1: from −X, 23.2° elevation, (1, 0.883, 0.612) × 1 [A].<br>• **Sky light** (Dynamic): Upper (1.5, 1.253, 0.749), Lower (0.938, 1.5, 0.401), SkyFactor 1 [A][I].<br>• **Four overhead point lights** LC_52/90/91/92 at (±2095–2182, ±3264–3303, 1828): (0.5, 0.446, 0.323), radius 3072, FalloffExponent 1.<br>• **Two goal lights** LC_113/114 at (0, ±5137, ~280): (1, 0.875, 0.723), radius 2048, FalloffExponent 2.<br>• Attenuation (1 − min(d²/R², 1))^FalloffExponent [M].<br>**Do not reach the car:** LC_0 and LC_2 (Unnamed_3/2 channels); the 46 Unnamed_1 field lights (34 enabled); the distant spots.<br>**Team sky-light volumes** (SkyLightVolumeComponent_TA overriding SkyLight_1; BlendDistance 100):<br>• inside, the sky light is the volume's: Upper (1.5, 1.253, 0.749), Lower = GetMaxColorBrightness(team primary) × LowerBrightness **2.0**, set on team-colour change (TA:90843-90848) [A][S];<br>• the native adds (volume − global) [N 0x140e97a40];<br>• extents (z −256..2304): goal ends \|x\| ≤ 960→2048 widening over \|y\| 3072→4160, to \|y\| 6208; side walls \|x\| 3392..4480, \|y\| 0..3072 (taper to 3392 at \|y\| 448..2624);<br>• Y < 0 is blue, Y > 0 orange; **the field centre and the corners keep the global green-tinted lower light** [A] | Hemisphere sky light (Upper/Lower above). Swap Lower for 2·maxbright(team primary) inside the six prisms (100 uu blend). A directional sun; point lights at the 6 positions. No ambient or SH. Replaces night.ts's white overhead sun and hemisphere for the car |
| PNT-30 | Car shadows | **Projected per-object dynamic shadow from the sun:**<br>• LC_1 CastDynamicShadows (default true), LightShadowMode Modulate, **ModShadowColor 0.4254**, ShadowFilterQuality High, bNonModulatedSelfShadowing [A];<br>• the car mesh casts (MeshComponent CastShadow, bCastDynamicShadow true), with the wheels and lens as shadow children (ModifyAttachmentPrimitive SetShadowParent, TA:18511-18518) [A][S].<br>**On receivers** (all scene geometry incl. the unlit grass): colour × lerp(1, 0.425, shadow).<br>**On the car itself:** the sun pass × shadow (normal self-shadowing).<br>The sun is low, so the shadow stretches 2.33 × the height toward +X.<br>**Settings:** DynamicShadows only in the High detail profile; RL ini MinShadowResolution 64 / MaxShadowResolution 1120 (engine), ShadowFadeResolution 32, bAllowBetterModulatedShadows FALSE [A].<br>**No blob or drop shadow** (body DropShadow switch off) [A].<br>The overhead and goal point lights also keep the default CastShadows with a **black** ModShadowColor; whether they render car shadows is open [A][I] | three.js: the sun as a shadow-casting DirectionalLight. Receivers multiply by lerp(1, 0.425, shadow) (a custom shadow pass, or shadowmap + a modulate term for unlit materials); the car uses normal self-shadowing |
| PNT-31 | Underbody | The chassis section (MIC_Chassis_Grain): underside, suspension, brakes, interior. 33.8 % of the chassis area faces down; mean D 0.13 grey, M.R 0.36, N.R 0.53 [A stats].<br>Lit mainly by the **lower sky light**: green-tinted (0.94, 1.5, 0.40) mid-field, the team colour × 2 in the PNT-29 volumes. The sun does not reach it under the self-shadow. No underglow product by default | Use the chassis material; its look is the hemisphere lower colour |
| PNT-32 | Plain-Fennec defaults | **Slots:** Decal/Skin none (MIC_Body_Grain blank skin); Antenna, Topper (Hat), Bumper (Front), Underglow none (no DefaultProduct) [A Startup ProductSlots].<br>**Products:** Wheels WHEEL_Star (OEM); Boost Boost_Standard; Glossy finish 270; colours 35/33 and accent 0 (PNT-3..5).<br>**Body attachments:** only Body_Grain_Lenses_SM.<br>**Body FX:** BoostConeMesh (Boost state, AttachDelay 0.1), AmbientBoost_PS (Spawned), and from the parent Body_FX.Body_FXActor the supersonic aura per team (VT-8).<br>Boost_Standard's BodyParticleParameters 'BoostGlow' finds no component on the Fennec, so it does nothing [A] | Nothing to add beyond lenses and wheels |
| PNT-33 | Corrections to other specs | • **VT-5:** Car+0x560 = RBActor_TA.MaxLinearSpeed = **2300** (Car_Default); the target also applies while boosting in the air.<br>• **VT-28/VT-29:** no PitchTek decals on Stadium_P.<br>• **PNT-10:** in matches the SH term is 0 and lights are separate passes (PNT-29).<br>• **PNT-12 / Fennec recipe:** "double the tail lights while braking" is ×(1 + Brake) inside L, i.e. ×4 on L² and ×16 on the L⁴ output; the chassis diffuse uses N·H.<br>• **AV-18:** the team sky-light volumes cover only the goal ends and the side walls, not the halves | – |

### Recipe additions (three.js, linear)
- **Windows:** a separate opaque material on the Skin.B region.
  - The body is one section, so mask it with PaintRegions.B or split the mesh locally.
  - out = Cube(R)·w(NdV)·E_sky(n) + min(Cube(R)·w, 1)·Sun·shadow + Sun·shadow·[N·H ≥ 0.99939].
  - w(x) = 0.5·(0.0386 + G(x))·fres(x);
  - G(x) = sat(12(x − 0.09375))·(1.25 − x²);
  - fres(x) = 0.3 + 6·(0.992·[x < 0.0977] + max(0.963·e^(−6.08x) − 0.039, 0)).
- **Sky term for every car material:** E_sky(n) = (1.5, 1.253, 0.749)·((1 + n_up)/2)² + Lower·((1 − n_up)/2)².
  - Lower = (0.938, 1.5, 0.401), or 2·maxbright(team primary) inside the team volumes.
- **Chassis:**
  - glow emissive (36, 1.44, 0)·Masks.A·clamp(I, 0, 2), I smoothed at 2/s toward v_fwd/2300 (grounded or boosting);
  - tail lights × 4 (L²) while braking;
  - headlights constant.
- **Wheels:** rim ≈ 0.03 (ring 0.15) with specular 0.25 and shininess 40; tyre ≈ 0.005–0.04 with a grazing grey term.
  - Diffuse uses N·H. No team colour.
- **Lenses:** translucent 0.5, VC-tinted box-projected reflection.
- **Shadows:** a modulated sun shadow at 0.425.

### Open
- **SkyLightVolume blend:** the exact per-primitive blend (bounds test and 100 uu BlendDistance) is read from the
  data only; the render-thread code past 0x140e97a40 was not traced.
- **Team colour conversion:** GetMaxColorBrightness and the LinearColorToColor round trip (sRGB or linear FColor) for the volume's
  team colour.
- **Point-light car shadows:** whether the 4 overhead and 2 goal point lights render modulated car shadows (they keep
  the defaults CastShadows and a black ModShadowColor), and whether point-light radius ignores the ×8 actor scale
  (assumed: ignored).
- **Missing light environment:** inferred from package data. A native-created light environment would bring back
  PNT-10's SH path; nothing in the exe names one.
- **ENVPack:** the window envC uses the ENVPack mean (0.103). The real term varies with R.xy (texture-only, local).
