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
| PNT-10 | Lighting model | Output = unlit·(Ambient + SH(n) + Sky upper/lower) + lit·LightColor [M].<br>• lit = diffuse curve (half-Lambert input) × (albedo·shade + rim) + (Spec·spec curve(N·H²) + reflection) × specColor.<br>• Reflection = ENV·env curve (ENVPack R sharp / G blurred, chosen by the rim curve A) + sparkle (ENVPack.A).<br>• Curves = LightFalloffArray rows.<br>• **Glossy fit:** Lambert diffuse, highlight ≈ (N·H)^72.<br>• Matte ^19 × 0.58, Metallic ^78 with env 0.37, Plastic ^24, trim ^13 with diffuse ~ (N·L)^1.5 | Standard three.js lighting is close enough. A faithful port can use the exported Vehicle_LightFalloffArray.png (sample linear) and Vehicle_ENVPack.png (RGB as sRGB); pseudocode in PNT1 notes §5 |
| PNT-11 | Unused on the plain Fennec | BodyNormalMap, FXMasks, Logo/TrimSheet: only through BodyAsset.SkinParameters with a decal. BodyMasks.A (tertiary/carbon) = the parent default with A = 0. ColorLookup (TeamColorScriptedTexture_TA) unused. Chassis TeamColorChassis off [A][M] | Nothing |
| PNT-12 | Chassis | MAT_Chassis_Grain (Phong) [M][A]:<br>• **Albedo** = lerp(Chassis_D, env cube, Masks.R) + edge brightening, × Chassis_N.R.<br>• **Specular** = Masks.R·(N·H)^128.<br>• **Headlights** = Masks.G where u < 0.585: HeadlightColor (0.583, 0.823, 0.978) × 2.5.<br>• **Tail lights** u ≥ 0.585: TailLightColor (3, .448, .448) × 1.33 × (1 + Brake).<br>• **On screen (corrected 2026-10-09):** the light term L = (GradMask + 0.75)·(head + tail·(1 + Brake)) is **squared** and multiplies Chassis_D, blended in by the same square: out = lerp(lit, L²·Chassis_D, L²) + 0.1·mask (chassis asm 119-147). So the headlights read as a clipped near-white core and the tail lights as saturated red (the painted GLB bake shows (255, 26, 0)), not the parameter hue at peak 1. Braking doubles L, which quadruples L² before clipping.<br>• **Boost glow** = (3, 0.133, 0) × 4 × Masks.A × 3·clamp(BoostGlowIntensity, 0, 2) | Metalness = sRGB → linear(PBR.R); roughness ≈ 0.3; AO = N.R; baked emissive map at strength 3.227. Using PBR.B as roughness (A1's guess) is not what the shader does |
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
