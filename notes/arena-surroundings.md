# Surroundings of Stadium_P ("DFH Stadium"): spec (static session, 2026-10-09)

**Shipping note:** the client may use the numbers here (statistics, profiles, placements, formulas), per the user's rule "texture-derived profiles and statistics OK, downsampled textures not". **Shapes traced from the game's meshes (the SUR-2/3/5/6 profiles) are local only** (user decision 2026-10-09). Shipped builds re-express them as rules plus a few named measures (as the field does in client stadiumFieldRules.ts), not as traced polylines. The stand-ins in SUR-37..44 avoid game artwork either way.

Live build 2026-10-06. Covers item H-11 "crowd and structures" and replaces the AV-22 summary. Game frame: uu, z up;
team 0 (blue) at y < 0, team 1 (orange) at y > 0. **az = atan2(y, x)** in degrees: 0 = +X (the open side),
90 = +Y (orange end), 180 = −X (the back), 270 = −Y (blue end). r = horizontal distance from (0, 0).
C = the cube-capture point (0, 0, 928). Colours are linear.

Tags: [A] package data; [M] compiled shader; [S] script; [N] native; [I] inferred.

Evidence is local and git-ignored, all under out/bsim/agents/SUR1/:
- **Fork reports:** mat_stands/, mat_lights/ and crowd/, each with notes.md, materials.json or crowd.json, and shader dumps.
- **Tools:** place.py (full-rotation placements), pano.py, geom_pass.py, compose.py, compose2.py and shade.py (panorama
  renderer and compositor), outline.py, visprofile.py and geometry_json.py.
- **Numbers (shippable statistics):** surroundings_geometry.json, reflection_profile.json, class_stats.json,
  surface_stats.json, fractions_opaque.json and outline_az.json.
- **Previews (local, game-derived):** view/*.png.

**Correction to AV-22:** "Stadium_Lights at x ≈ −14500, z 11–12.6k" is the mesh-local bounding box. Placed in the
world (yaw ±72°, z −2304, y-mirror) the two banks sit over the ends at r 14.9–16.7k, z 8.75–10.35k (SUR-8).

## Layout and geometry
| # | What | Game | Implement |
|---|---|---|---|
| SUR-1 | Overall layout | A horseshoe ("C") bowl centred on the arena [A]:<br>• **Open +X side:** no stands for \|az\| < 27°; the skyline shows through.<br>• **−X back:** an entrance plaza gap at \|y\| < 1964 (az 171–189°) holds a statue on a plinth and trees. It is a gap in the stands only, **not an open sightline** from C: below el ≈ 7° it is closed by the plinth (az 177.1–182.9, el 1.5–7.1), the plaza walls and sidewalk (el −7.4..1.4, r 13.2–17.4k), poplars (el 1.1–10.5) and the low roof ends (az ≤ 176 and ≥ 184, el 1.4–10). First open sky by az: 177: 6.9°, 178: 9.4°, 179: 11.9°, 180: 14.4°, 181: 8.6°, 182–188: ≈ 15°; az 172–176: none below 17.4° (corrected 2026-10-09, CAL1).<br>• **Symmetry:** every stand piece is placed twice, the second with Scale3D (1, −1, 1). Stadium_Top, Stadium_Supports, Stadium_Trim and CountryFlags are single symmetric meshes.<br>• **Team halves:** team-dependent materials switch at y = 0 (blue y < 0, orange y > 0).<br>• Plan render: view/plan_stands.png | Build one half (y ≥ 0) from the tables below and mirror it. Swap team colours on the mirror |
| SUR-2 | Lower bowl (az 27–171°, mirrored) | Circular about (0, 0) [A]. Section from C's visible-profile trace at az 90, as (r, z) [A, simplified to 150 uu]:<br>• **apron/front wall:** (11178, 122) → (12060, 481);<br>• **TV strip on the front wall:** r 11.7–12.1k, z 512–797 (SUR-17);<br>• **4 front rows:** (12052, 797) → (13458, 1251);<br>• **walkway step:** (13458, 1251) → (13598, 1789);<br>• **main rake:** (13598, 1789) → (17588, 2583) → (21010, 3834);<br>• **back edge:** r 21.3k (22.9–23.2k at az 145–165), top z ≈ 3.8–4.1k.<br>Crowd rows (crowd/tiers.json): 4 front rows at card-centre z 948–1119; 25–34 main rows at z 1834–4013, r 13.5–21.4k; row pitch 220–245 uu radially; rise 52–84 uu per row.<br>Similar profiles at az 135 and 165 (visprofile.json) | Revolve the polyline over az 27–171° |
| SUR-3 | Upper tiers (az 76–139°, mirrored) | Over each end and the −X corner [A]:<br>• **mid tier:** TV strip at r 14.75k, z 3160–3360; rake (14772, 3433) → (18231, 5263); step to (18224, 5514); then → (20036, 6626);<br>• **top tier:** (15842, 5508) → (17685, 7584);<br>• seats reach z 9.6k at az 105.<br>Crowd_04 rows: mid tier 12 rows at z 3.7–5.0k (r 15.2–17.5k) plus 10 rows at z 5.7–6.9k (r 18.1–20.2k); top tier 21 rows at z 6.0–9.0k (r 15.4–19.1k); rise 123–157 uu per row | A second revolved profile over az 76–139° |
| SUR-4 | Base, concourse, plaza | **Concrete walls** (Stadium_Base section 3): r 10.9–31k, z −4.0k to 8.1k. They form the stand undersides and back walls, plus a basement below grade at −X (z −3.9k at az 155–205).<br>**Outer concourse** (Stadium_Base_Outer, sidewalk and grass): r 23–34k, z 0.5–9.3k.<br>**Plaza (−X):** ground (sidewalk) at z ≈ 1.2–1.31k out to r ≈ 19.2k, i.e. el ≤ 1.4° from C (corrected 2026-10-10; the earlier "z 1.3–1.8k from r 12k to 20k" mixed in the plinth ramp, which rises to z 2434).<br>**Statue:** actor (−12112, −144, 2976) (the pivot, not the centre), scale 3; world bbox x −13199..−11591, y −380..283, z 2339..3841. From C: az 178.7–181.9, visible el 7.1–14.1° (its base sits inside the plinth).<br>**Plinth** (part of Stadium_Base; Concrete_MAT sides, MIC_Sidewalk00 top): a wedge ramp whose top is flat at z 2434 for x −13.3k..−12.1k, then falls to z 1280 at x −19.7k; half-width 267–668 (267 is its narrowest section; the angular extent az 177.1–182.9 at r 12.1–13.3k needs ≈ 640–670 near the front; corrected 2026-10-10); vertical front face at x −12.12k (z 2272–2434), then undercut (corrected 2026-10-09).<br>**Glazed boxes** (Stadium_Base_Glass, hex glass H-6): x −7.9k to −1.2k, \|y\| 12.4–15.2k, z 1.3–3.8k | Low priority: dark mass behind the bowl |
| SUR-5 | Roof arch (Stadium_Top) | A C-shaped band with one arch over each end, low at the back and toward +X [A]. Percentiles p1–p99 of r and z by az:<br>• 45°: r 22.2–25.1k, z 3.0–7.0k<br>• 65°: r 18.0–21.0k, z 8.0–10.8k<br>• 85°: r 16.0–18.2k, z 10.5–12.2k<br>• 105°: r 15.4–17.4k, z 11.2–12.6k<br>• 125°: r 15.9–18.7k, z 10.6–12.5k<br>• 145°: r 17.3–21.9k, z 8.4–11.4k<br>• 165°: r 20.5–26.6k, z 2.7–8.5k<br>• 175°: r 22.1–27.4k, z 1.3–5.5k<br>Peak z 12.6k at az ±105–115°. From C it is a band at el 3–35° (mean el 23°). Every 10° in outline_az.json | Sweep a ~2–6k-wide band along this table |
| SUR-6 | Glass canopy (Stadium_Glass, Stadium_Glass_02) | A sloping translucent canopy [A]. It runs from a high inner edge (r ≈ 14.7–16k, z ≈ 11.5k) down to a low outer edge (r ≈ 26k, z 0.8–3.2k), over az 55–165° (mirrored). Over the end centre (az 95–115) only its top strip exists. Seen from C at el ≈ 19°, 0.69 sr per side unoccluded.<br>Vertex R (used by the shader, SUR-15) by z: 2–3k 0.94; 4–5k 0.65; 6–7k 0.36; 7–8k 0.14; 8–9k 0.04; ≥ 9k ≈ 0. Linear fit R ≈ sat(1.12 − 1.13e−4·z) | Mesh from the edge tables; R from the fit |
| SUR-7 | Steel supports | **Stadium_Supports** (DarkMetal_Mat): truss arches rising from the ground at r ≈ 25.6k (z 1.4k) to the roof at r 15.2k (z 10.7k). Their tops sit 1.8–2.7k below the roof's inner top edge at \|az\| 45–145 and still reach z 10.2–10.6k at 155–165; they continue to about \|az\| 173 (added 2026-10-09).<br>**Stadium_GlassSupports:** canopy mullions; section 1 is MetalBeam_SoftEdge_Lights_MIC, beams with team-coloured light dots (SUR-14).<br>**Monorail_02** ×4: two elevated tracks behind the −X side at x ≈ −55k to −5k, running along y from −52.7k to 90.6k, z 11.9–14.8k [A] | Thin dark mirror-like members (SUR-14) |
| SUR-8 | Floodlight banks and light rigs | **Stadium_Lights** ×2: one 17k-long curved bank per end on the roof's inner edge [A]. Cross-section 936 × 1622 uu; r 14.9–16.7k, z 8.75–10.35k, az 75–135° (mirrored); seen from C at az ±108°, el 31°.<br>**LightBulbs_01/02_Combined:** 8 bulb clusters per end along the roof arch, r 14.1–19.0k, z 9.0–11.7k, az 65–155°.<br>**Stadium_LightCones:** additive beam sheets from the banks down to the field, z −4.8k to 11.1k | Emissive strips plus additive beams (SUR-12, SUR-13) |
| SUR-9 | Big screens and ads | [A]:<br>• **Low screens** (Loft_Quad_01, Scoreboard_MIC): (−21851, ±5448, 3670), 2279 × 1152 uu, facing the field; from C at az ±166°, el 7°.<br>• **High screens:** (−5765, ±17700, 10260), 3038 × 1536 uu, tilted 34° down; from C at az ±108°, el 27°.<br>• **2x1 ads** (Loft_Quad_01): (18453, ±13440, 6900), 5697 × 2880 and 5317 × 2688 uu.<br>• **4x1 billboards:** (12160, ±19.3k, 5040) and (−20.6k, ±8.6k, 5104), 2560 × 640 uu | Quads at these placements (contents SUR-16, SUR-18) |
| SUR-10 | Near-field props (outside the cage, inside r 7k) | [A]:<br>• **Banner scaffolds** ×8 (Park_BannerScaffold00, DetailMode High): towers of 273 × 273 × 1049 uu at (±2048, ±6144), behind the goals, and at (±4736, ±1024), beside the side walls.<br>• **Corner banner flags** ×4 groups (Park_BannerFlag_CMB, DetailMode Medium): each group is **5 poles** on an arc at r ≈ 6.08–6.29k, ≈ 5.6° apart (banner centres az 43.8, 49.2, 54.4, 60.1, 66.3 in the +X+Y corner; 113.6–136.1, 222.6–245.1, 294.9–317.5 for the others). Pole Ø 15–16, z −1..751, top arm ≈ 88. **Banner:** vertical, 133 wide × 559 tall (z 175–734), a shaped cloth (81 % of that rectangle), facing C; plus a top strip (z ≈ 634–751). From C each banner is ≈ 1.2° × 5.1° (el −7.0..−1.8); a group covers 0.0073–0.0085 sr, 6.1 % of a 30° sector at el −3..0. (The earlier "2.0k × 1.5k × 0.79k" was the group's bounding box; corrected 2026-10-09, CAL1.)<br>• **Light-arrow arrays** ×4 (StreetSignArrows): at the corners (±3312, ±4352), z 384–512.<br>• **Team uplight beams:** SUR-13 | Team-coloured banners and flags (SUR-19) |
| SUR-11 | Flags, trees, city, sky beams | [A]:<br>• **CountryFlags:** a ring of flags on the roof arch, r 15.1–21k, z 4.7–10.6k (from C at el 20–35°).<br>• **Trees:** 40 LombardyPoplar_Mini on the plaza and stand tops; one LeafyTrees_01 cluster on the −Y side (x −10.9k to 19.5k, y −21.6k to −10k, z 3.8–9.3k, DetailMode High).<br>• **Skyline:** SkyScrapers_01 (−Y side) and _02 (+Y side), towers 57–200k away rising to z 159k and 285k. From C they cover 1.04 sr at el ≈ 22°, looming behind the stands.<br>• **Far city:** City_OOB_A ×3 (scale 384–768), 250k–1.3M away.<br>• **CityGround_01:** an 8M-wide bowl of city lights, z −67k under the stadium rising to +101k at r 3.8M; it shows only through the open +X side and gaps, below the horizon.<br>• **Sky searchlights:** SpriteXY ×2, 524k-tall beams at (22.7k, ±20.6k); plus LightCones_Triangle (three crossing 2.1M beams) | Silhouette boxes for the skyline; a dark ground with an emissive rim |

Per-instance world bounding boxes, translations, rotations and scales: surroundings_geometry.json["instances"].
Visible (r, z) profiles from C every 15°: ["visible_profile_from_capture"]. Crowd tiers: ["crowd_tiers"].

## Materials
Formulas come from the HQ base-pass shaders. Lit surroundings are lightmap-only: out = Diffuse·L + Emissive, with
L = C0·dot(C1, 1/3) for a flat normal (LMP convention; no ambient or sky term in game) [M]. "Seen" means the mean
from C, flat normals, with unoccluded and occluded weights as noted.

| # | What | Game | Implement |
|---|---|---|---|
| SUR-12 | Floodlight banks (StadiumLight_Mat, lit, opaque) | With y = \|2v − 1\| and tri = 1 − \|2·frac(5v) − 1\| [M]:<br>E = (1 − y)²·tri·16·max((0.5, 0.48274, 0.38116) − y, 0)·sat(2·(D.r + 1/32)).<br>• Three bulb rows at v = 0.3, 0.5, 0.7; the centre row peaks at (8.0, 7.72, 6.10).<br>• **Not team-coloured, not animated.**<br>• Front-facing mean from C: E (0.61, 0.58, 0.39); total with the lightmap (0.71, 0.67, 0.46); 11 % of the area exceeds 1 | Warm-white emissive strips, peak 8; procedural bulb mask (SUR-41)<br>**Layout (2026-10-09, Q3A):** 42 separate fixtures per bank in 6 groups of 7 (pitch ≈ 233–241 uu; group gaps 735/747; centre gap 5184), each sampling StadiumLight_D once (UV0 × 1, no tiling). E > 1 only in one row, v 0.406–0.594 (100 % for v 0.469–0.531); the other rows peak at 0.58. SUR-41's "11 %" is the fraction of texels with D ≥ 0.469, not a bulb-cell coverage. Profiles: out/bsim/agents/Q3A/q3/profile.json. |
| SUR-13 | Beams | **Floodlight flare sheets** (StadiumLight_Flare_Mat): additive, rgb = Flare.G·white; area mean 0.025, p95 0.08, max 0.62 [M].<br>**Team uplight beams** (LightCone_Team1/2_MIC, translucent, two-sided) [M][A]:<br>• a = LightCone_Pack.B·(1 − u)², k = sat(a − 0.25); rgb = P + k·(FB − P) + k.<br>• The Team1 MIC is blue (team 0) and the Team2 MIC orange.<br>• 10 vertical beams per end behind the corners, 4096 uu tall from z −848, 128 uu wide. Two are 6144 × 256 at (±1136, ∓5361), plus 4 beside the side walls at (±4560, ±128).<br>• Mean alpha 0.022 (faint).<br>**Searchlights** (LightCone_Simple): white, alpha ≈ 0.03 | Additive white sheets; faint team-coloured vertical beams |
| SUR-14 | Steel (DarkMetal_Mat; LessShine MIC on OOBFloor_Trim) | A pure GrassCube reflector [M]: env = ENVBrightness·GrassCube(R)·(\|R_ts.z\| + 1/16); out = env·L + 0.25·(1 − \|R_ts.z\|)·env.<br>• Mean coefficient on the cube k: supports (1.79, 1.61, 1.12); glass supports ≈ 0.8; monorail ≈ 1.15; LessShine ≈ 0.17.<br>**MetalBeam_SoftEdge_Lights_MIC** (translucent, two-sided, NonDirectional lightmap at 3×):<br>• emissive dots = 4·FB(team primary)·sat(24·(Pack.R(u/8) − 0.965)); dots at frac(u/8) ≈ 0.21–0.28, covering 4 % of the area; team by sign of Y;<br>• diffuse = Pack.G(u + v)·Pack.R(v), mean 0.154; alpha = Pack.B (soft ends) | Dark metal; sample our own cube with k ≈ 1–1.8. Team dots = 4·FB |
| SUR-15 | Glass canopy (Glass_Projected_V2_Mat / _Team2_MIC, unlit, alpha 0.5) | **Team-tinted** [M]: emissive = 2·(R² + R + 1/16)·FB(team primary), where R is the vertex colour R (SUR-6). Base material = team 0 (slot T0PFB) at y < 0; Team2 MIC = team 1 at y > 0.<br>• It glows the team colour at its low outer edge (×2.7–3.7) and fades to 0.125·FB at the top.<br>• The UV sets are unused | Alpha 0.5, emissive by the formula |
| SUR-16 | TV strips (Advert_Strip_Mat, lit) | E = 0.5·(1 − (2·frac(2v) − 1)²)·(Advert_Strip + 0.35·N_view) [M]. N_view = view-dependent noise; mean of Noise_Shapes.R = 0.225.<br>• **Content:** two rows of the 4×2 ad atlas repeated about 5× along the strip. White panels (lin 0.76–0.83) alternate with dark panels (0.07) carrying a white emblem (25 % bright). Whole-atlas mean (0.519, 0.536, 0.581).<br>• Seen from C: E (0.20, 0.21, 0.23); total (0.22, 0.23, 0.25). About 0.054 sr each at az ±109°, el 5°.<br>• **Extents** (added 2026-10-09): lower strip \|az\| ≈ 48–98 and 118–167; mid strip ≈ 83–137; a top-tier front strip at r ≈ 15.2k, z ≈ 5.4–5.7k, \|az\| ≈ 93–122 (el 16.4–17.4° from C) | Ribbons of alternating light/dark panels with our own emblems |
| SUR-17 | Big screens (Scoreboard_MIC, lit; emissive = diffuse = D, shown D·(1 + L)) | With t = sat(Y/256 + 0.5) [M]:<br>• C = (8/3)·(lerp(FB0, FB1, t) + lerp(P0, P1, t)) − 0.125; e = sat(32·(\|2v − 1\| − 0.75)).<br>• base = lerp(0.125 + e·C, Logo.rgb, Logo.a).<br>• D = 0.5·(1.1875 − (2v − 1)⁴)·(base + 0.35·N_view).<br>• **Default content:** a dark screen (0.12) with the Rocket League logo (light blue-white, 14 % coverage, uv 0.09–0.93 × 0.35–0.65). Team bars cover the top and bottom 12.5 %: half-value blue (0.17, 1.02, 2.33), orange (1.88, 0.93, 0.19).<br>• **Never shows scores:** BlueScore/RedScore are compiled out (ScriptedTexture = F), and Stadium_P has no score event [M][S].<br>• Totals: low +Y (1.10, 0.70, 0.36), low −Y (0.47, 0.72, 0.89); high +Y (0.50, 0.35, 0.22), high −Y (0.22, 0.36, 0.55) | Dark panel, our logo (14 %), team bars |
| SUR-18 | Ads (2x1 / 4x1 MICs, lit) | D = 0.5·(1.1875 − (2v − 1)⁴)·(AdTexture + 0.35·N_view) [M].<br>• **Offline defaults stay** [S]: AdManager_TA swaps AdTexture only after a PsyNet login with a cached ad.<br>• **Defaults:** dark panel lin 0.053 with a centred light emblem (0.59) covering 21 % (4x1) or 11 % (2x1).<br>• Totals: 2x1 (0.24, 0.23, 0.20); 4x1 (0.17–0.18) | Dark panels with a small emblem |
| SUR-19 | Near-field props | **Basic_Orange_Mat** (scaffold banners): **team-coloured**, c₀ = 0.5·lerp(W, 4T, w) + sat(1.5·(D − 0.25)) with W = (1, 0.969, 0.906) and w ≈ 1 (so c₀ ≈ 2T + sat(…)); then a saturation boost c = clamp(c₀ + 0.15·(c₀ − lum(c₀)), 0, 1.5), lum weights (0.3, 0.59, 0.11). Mean of sat(1.5·(D − 0.25)) over Park_BannerScaffold_D (linear) = 0.153 per channel (texture mean 0.299); lit with k = 0.575 (corrected 2026-10-09: the boost and W were missing). T = P + (FB − P)/16 per side, giving blue (0.29, 1.03, 1.5) and orange (1.5, 0.90, 0.27) [M].<br>**Corner flags** (MIC_Park_BannerFlag00): **opaque, two-sided** (no discard, no blend); 1D vertex lightmap; col = X.R·lerp(4T, X.A, w) + 0.25·GrassCube(R), w = X.A + X.B − X.A·X.B; out = col·L; wind WPO; T by world Y, orange (0.760, 0.390, 0.098), blue (0.097, 0.445, 0.987) [M]. Texture statistics: banner E[X.R(1 − w)] = 0.500, E[X.R·X.A·w] = 0.295 (mean albedo 0.500·4T + 0.295; 57 % team-coloured); top strip 0.788·4T + 0.002. Flat L: +X corners ≈ (0.83, 0.75, 0.55)/(0.76, 0.68, 0.51), −X corners ≈ (0.45, 0.41, 0.31). Seen group mean from C (LDR, lum): az 54 orange (0.83, 0.76, 0.28) 0.73; az 125 orange (0.71, 0.47, 0.17) 0.51; az 235 blue (0.24, 0.52, 0.68) 0.45; az 306 blue (0.41, 0.74, 0.71) 0.64 (added 2026-10-09, CAL1).<br>**MetalTexture / FlagPole:** grey metal plus a GrassCube term.<br>**LightArray_Arrow:** emissive D·sat(8·(D.a − 0.25))·(1 + sin(2π·(phase + t))), a 1 Hz pulse with per-object phase [M] | Team-coloured banners at ≈ 2× primary (clamp 1.5); pulsing arrows |
| SUR-20 | Stands (lit, lightmapped) | [M], with seen means from C:<br>• **Concrete_MAT** (base walls, the dominant stand surface): albedo = Concrete_CLR_lin (0.433, std 0.04)·sat(Carbon.z)·g, g = 1 + 3·Σ sat(2·(\|R_ts,i\| − 0.75)) (sheen up to 2.5 at normal incidence). Seen (0.156, 0.150, 0.108), L ≈ 0.16.<br>• **SeatBase_Mat:** grey Step_D ramp, albedo 0.254, seen (0.071, 0.070, 0.055). **No team colour on seats.**<br>• **Stairs_Mat:** 0.14/0.37 stripes, 16 per V, seen 0.083.<br>• **ConcreteTrim_Dark:** albedo 0.144, seen 0.021.<br>• **MIC_Sidewalk00:** (0.359, 0.332, 0.314) + 0.1875·env; seen 0.10 and 0.05.<br>• **Statue:** 0.52·(2 − cosθ)·L; seen ≈ 0.17<br>• **Trees:** masked (≈ 43 % coverage); olive-brown (0.15, 0.11, 0.024)<br>• **Grass_Base_Mat:** < 0.01 sr | Dark warm grey concrete ≈ 0.15, seats 0.07, trims 0.02 |
| SUR-21 | Roof (StadiumRoof_Mat, lit) | d = 0.3125 on two strips per UV tile (26 % of the area), otherwise 0.094 + Swirls/16; plus 0.25·SpecGlow02(R_ts); all × (1 + cosθ) [M].<br>• SpecGlow02 is a centred blob per cube face: 0.87 at 0–5°, 0.56 at 10–15°, 0.30 at 20–25°, 0.11 at 30–35°, 0 beyond 45°.<br>• Seen (0.161, 0.143, 0.095) | Grey underside 0.16 with two lighter strips |
| SUR-22 | Screens of the city (Building_MIC, unlit; BuildingLight_Mat; CityLights_01_Mat) | **Buildings:** E = 2·(1 − mask)·lights·sat(4·N·V)·Color + 2·(1 − mask)·clamp(1.5 − N·V, 0, 4)·OOBCube(R), with Color (0.497, 0.437, 0.299, 0.85). Mean (0.19–0.21, 0.16–0.17, 0.10–0.11) [M].<br>**Warning lights:** white, alpha ≈ 0.06, 2 s blink.<br>**CityGround:** E = 32·B·(A + B/32)·(1 − v) + v·(0.748, 0.574, 0.265). The warm horizon glow dominates at the rim (v → 0.95, el 0–1.5°); traffic pans (0.00945, 0.0125)·t and (−0.0025, −0.025)·t [M] | Warm window grid ≈ (0.20, 0.17, 0.11); orange horizon glow |
| SUR-23 | Fog layers (translucent, unlit) | **FogCylinder** (r 57.3k, DetailMode High): rgb white; alpha = Curve_Fire_Color_01.G(v)·sat(depth/4098) [M]. By el from C: −5..5° 0.87–0.92; 5–10° 0.73; 10–15° 0.43; 15–20° 0.19; 20–25° 0.06; > 30° ≈ 0.<br>**StadiumFog** (FogMesh_01, half-rings r 7.6–46k): **not team-coloured**. h = sat(Z/8197); rgb = h; alpha = (1 − h)·vertex alpha (mean 0.40); alpha 0.19 at el 0–10° and 0.15 at 10–20°.<br>**Fog sheets** (FogSheet_Mat on 6 visible Circle_Sprites): rgb (0.533, 0.686, 0.725), alpha = FillFlare.G·a (≈ 0.3). The 4 team-coloured fog sheets are HiddenGame.<br>**Fog bowl** (SkySphere01 at z 4054, FogHemisphere_V2): H-10; alpha by Curve_FogDusk.A: 0.88 for v < 0.56, 0.70 at 0.63, 0.50 at 0.69, 0.29 at 0.75, 0.12 at 0.81, 0.035 at 0.88, 0 at the rim. Every translucent layer takes vertex height fog<br>**Fog (2026-10-10, FOG1):** every translucent layer takes vertex height fog [M]; use the FOG-6 maths per vertex, uncapped. | Horizon band and haze: alpha-by-elevation tables |
| SUR-24 | Height fog: shaders [M], constants and mapping [N] | **Shader** [M] (GlobalShaderCache TExponentialHeightFogPixelShader; every fog-enabled translucent base-pass VS), with Δ = receiver − camera:<br>• line = Cd·max(\|Δ\| − 10240, 0)·(1 − 2^(−f·ez))/(f·ez), with ez = Δz, or 0.01 when \|Δz\| ≤ 0.01<br>• F = max(min(2^(−line), 1), 0.1)<br>• t = \|0.5 − 0.499·L·Δ̂\|^p; colour = lerp(Ins, Opp, t)<br>• out = scene·F + (1 − F)·colour.<br>**Constants** [N] (FUN_140a667d0, FUN_140a1b670):<br>• Cd = 7.5e-5·2^(−2e-4·(camZ − 6783.999)), with camZ = ViewOrigin.Z<br>• f = 2e-4<br>• p = −0.30103/ln(0.5 − 0.5·cos 22.5°) = 0.0921<br>• Ins = (1, 0.3250, 0)<br>• Opp = 0.15·(0.1940, 0.5174, 0.7083) (gamma-2.2 FColor table)<br>• L = the fog actor's Rotation.Vector() = (−0.9791, 0.0131, −0.2030): no dominant directional light in Stadium_P, so it is not the sun.<br>**Depth** [N]: the PS reconstructs SceneDepth = 1/(min(d, 0.999)/M32 − M22/M32 + 1e-8).<br>• **Main view:** infinite far plane (M22 = 0.999), so no cap; opaque geometry beyond 10,240 uu (stands, roof, city, sky dome) is fogged.<br>• **GrassCube** (near 32, far 9,999,999): opaque fog depth capped at 31,887 uu along the face axis.<br>• **Translucent:** vertex fog, uncapped.<br>**Consequences:**<br>• The far stands are visibly fogged in game (F ≈ 0.6–0.85 at 12–16k).<br>• The sky is fogged to F ≈ 0.52–0.56 at the zenith and to the 0.1 floor below el ≈ 15°.<br>• The orange inscatter (≤ 47 %) sits around az 179°, el −12°; elsewhere the fog is the dim blue Opp | Implement as the FOG-15 chunk on all opaque materials incl. the sky; per-vertex on translucent/particles; cube camera at C with the 31,887 cap |
| SUR-25 | Sky | H-10 (unchanged). Evaluated from C [M] + local noise statistics: mean sky radiance (0.070, 0.064, 0.045) over el 0–90° with occlusion (surface_stats.json); el 50–90° ≈ 0.02–0.05 (luminance). A star field (stars term) and brown clouds near the horizon; the bright warm horizon (≈ 1.5) is hidden behind the stands, **including** at the −X plaza gap (plinth, plaza walls, trees and roof ends; corrected 2026-10-09). With no fog the sky alone gives el 50–65 ≈ 0.054 and 65–90 ≈ 0.030 (H-10 zenith base lum ≈ 0.037 plus stars); fog inscatter adds only ≈ 0.01<br>**Corrected 2026-10-10 (FOG1):** fog inscatter in the cube adds 0.030 at el 65–90 and 0.035 at 50–65 while transmitting the sky × 0.66 / × 0.60 (net +0.019 / +0.014); in the main view from C the zenith is F 0.56 (+0.038 lum), and F reaches the 0.1 floor below el 15°. | As H-10 |

## Crowd
| # | What | Game | Implement |
|---|---|---|---|
| SUR-26 | Cards and layout | 27,986 cards, 13,993 per team, one person per card [A]:<br>• **Counts per team:** Crowd_01 3,989 (−X side stand, az 117–171°); Crowd_02 3,283 (end behind the goal, 72–117°); Crowd_03 2,750 (+X corner/end, 27–72°); Crowd_04 3,971 (upper tiers, 76–139°).<br>• **Team split:** Crowd_ST_Team1_Mic is team 0 (blue) at y < 0 (slots c37/38/41/42); Team2_Mic is orange [M].<br>• **Card:** vertical quad, 126.0 × 146.8 uu, facing the arena centre.<br>• **Spacing:** 144 uu along a row; rows as in SUR-2 and SUR-3.<br>• **Gaps:** none for \|az\| < 27° or beyond ±171°.<br>• **Aisles** (corrected 2026-10-10 from cards.npz): 5 per side, centred at \|az\| 45.6, 71.9, 98.1, 117.6, 143.9°. The gap between card centres is 2.0–3.1° in rows 0–12 and 1.5–2.4° above. The aisles run through all 34 main rows at the first four positions; the one at 143.9° stops near row 18.<br>• **Per card:** constant vertex colour (r, g, b i.i.d. uniform 0–1). UV1.y = 1.0986 − 1.0994e−4·z (height ramp); UV1.x ≈ 1.19 − az/144° (azimuth ramp) | Generate our own cards along our bowl: 144 uu pitch, rows per tier, random r, g, b per card |
| SUR-27 | Shape and mask | Masked (clip 0.1), two-sided, lit with a 1D vertex lightmap [A][M]. With q = 2·frac(UV0·(16, 1)) − 1, discard where \|q\|² > 0.9: an ellipse covering 70.69 % of the card. UV0 cells are 1/16 wide, but the cell index has no effect.<br>Normal = sphere (n.xy ≈ 0.876·q) in a frame whose Z is world up, so each disc is shaded as if it faced the sky. Albedo × (1 − UV0.v) darkens the bottom | Ellipse discs; n.xy = 0.876·q; no texture needed |
| SUR-28 | Presence (vertex shader) | x = 0.5·(lum(rgb) + b − 0.5) + 0.35·UV1.y + CrowdSize − 1.375; the card sinks by (1 − sat(32x))·128 uu [M]. Cards stand about 93 uu above the seating (p5–p95 91–100). CrowdSize 1.25, so 96.0 % are visible: 78.5 % at the top of the stands, 99 % at the bottom | Hide ~4 % of cards, more higher up |
| SUR-29 | Team colour rule | p = sat(32·(0.912·frac(2.19298·(r + g)) + 0.35·UV1.y + CrowdSize − 2)), so P(team) ≈ 0.178 + 0.384·UV1.y; 42 % of visible people wear team colours [M].<br>• m = sat(32·(g − 0.75)): about 25 % of fans wear the secondary colour.<br>• C = lerp(lerp(P, S, m), lerp(FB(P), FB(S), m), b).<br>• team albedo = clamp(8·clamp(C, 0.0425, 1), 0, 2); neutral = 1.5·(rgb + 0.25).<br>• albedo = clamp(lerp(neutral, team, p), 0, 2)·(1 − UV0.v).<br>The ×8 and clamp wash team colours out: blue P → (0.78, 2, 2), orange P → (2, 2, 0.78) | As written |
| SUR-30 | Animation | world z += 48·Cheer·sin(4.66943·(Time·(r + 0.5) + UV1.x)) [M]:<br>• **Cheer stays at its default 0.25**, so the amplitude is a constant 12 uu.<br>• Each person bobs at 0.743·(r + 0.5) Hz, i.e. 0.37–1.11 Hz, with an azimuth phase, so the motion is incoherent.<br>• **Nothing drives Cheer** [A][S]: no script, exe string, config or Matinee; goals don't change the visual crowd. CrowdActor_TA / CrowdManager_TA / CrowdSounds_TA are audio only (GameExcitement RTPC).<br>• The LQ shader has no bob | Constant 12 uu bob; no goal reaction |
| SUR-31 | Look from the arena | Baked light for a flat normal: median 0.20; Crowd_03 (+X ends, sunlit from −X) 0.46–0.51; the rest 0.13–0.20 [A].<br>Mean disc colour: blue side (0.154, 0.204, 0.159), orange side (0.209, 0.201, 0.106).<br>Occluded, from C (surface_stats): crowd pixels (0.144, 0.161, 0.111) over 0.72 sr at mean el 8.8°; Crowd_03 brighter (0.21–0.30).<br>Dim, bobbing pastel discs with washed-out team fans, against dark stands | Lighting per region: 0.2, or 0.5 on the +X ends (crowd/light_profile.json) |

## What the stands look like from the arena centre
- **Mostly dark warm-grey concrete and seating.** In the game view from C (occluded, no hotspots, compose2
  "mainview", opaque surfaces only), by class: stands 0.12 (0.124, 0.119, 0.088) and crowd 0.15. Roof underside
  (0.161, 0.143, 0.095), steel 0.19, screens and strips 0.26, floodlight banks 0.68 (warm white).
- **The skyline is as large as the stands.** Unlit warm windows (0.21, 0.17, 0.11) cover 1.18 sr, mostly at
  el 10–40°.
- **Team colour comes from these** (the seats carry none):
  - the glass canopy's emissive base (×2.7–3.7 FB, alpha 0.5);
  - the beam light dots (4·FB);
  - the team light bulbs (8·P, front mean blue (0.09, 0.40, 0.89), orange (0.73, 0.37, 0.09));
  - the screen bars;
  - the near-field banners and flags;
  - about 42 % of the fans.
- **With the translucent layers** (glass canopy, fog bowl, horizon band, cage) the classes read: stands
  (0.157, 0.171, 0.169), crowd (0.215, 0.228, 0.209), roof (0.201, 0.169, 0.135). See class_stats.json["mainview"].

## The reflection cube (GrassCube) and its profile
| # | What | Game | Implement |
|---|---|---|---|
| SUR-32 | Capture settings | SceneCaptureCubeMapActor at (0, 0, 927.9998) [A]:<br>• GrassCube: 256² per face, PF_A8R8G8B8 (**LDR, 8-bit**), bRenderOnce.<br>• NearPlane 32, FarPlane 9,999,999, ViewMode LitNoShadows (default), bEnableFog.<br>• Post-process Cubemap_Blur64_PP = DOFAndBloomEffect with BlurKernelSize 64 and MinBlurAmount 1, i.e. a full-frame blur.<br>• FrameRate 3, MaxCaptureTime 2.0.<br>• Team_TA.ForceRecaptureScene re-captures **only in freeplay** [S]<br>**Fog in the capture (2026-10-10, FOG1) [N]:** Cd 1.6890e-4 (ViewOrigin z 927.9998); the opaque fog depth is capped at 31,887 uu along the face axis (near 32, far 9,999,999, deviceZ clamp 0.999); translucent layers get uncapped vertex fog.<br>**Blur (2026-10-10, PP-31) [N]:** each face is blurred on its own (not seamless), in float HDR, before the 8-bit store: a separable Gaussian on a 64² copy per face, variance 3.2 texels² (σ ≈ 1.79 at 64², ≈ 7.2 px at 256², ≈ 3.2° at the face centre, ≈ 2.1° at a face-edge midpoint, ≈ 1.35° at a corner; corrected 2026-10-10), normalised at face edges; then saturate and pow(1/2.2) on store. The GGX "seamless" pass is off for GrassCube. The earlier "64-px full-frame blur" and the profile's σ 12° were too wide.<br>**Store and sample (2026-10-10, CAP1) [N][A]:** PF_A8R8G8B8 with SRGB; the cube is R8G8B8A8_UNORM_SRGB (one sRGB SRV), each face a UNORM 256² target. Store: FGammaCorrectionPixelShader writes sat(c)^(1/2.2) (InverseGamma = 1/GetDisplayGamma = 1/2.2), raw-copied into the cube. Sampling decodes sRGB before filtering, with no pow in the material. Net: 0.01 → 0.0137, 0.18 → 0.1779, 0.5 → 0.491. The cube starts **green** (0, 1, 0) (UpdateResource clear), with no effect after convergence (by capture 3). Each face is copied into the cube right after it renders.<br>**Clone recipe** (CAP1): six 256² linear-HDR faces with fog and hotspots; per face 4×4 box → 64², 9-tap separable Gaussian (weights 0.22546, 0.19285, 0.12068, 0.05524, 0.01851) with a weight channel (taps outside the face count 0; divide by the weight), bilinear up to 256²; store srgbToLinear(round(255·pow(sat(c), 1/2.2))/255) in RGBA16F (exact) or render to SRGB8_ALPHA8; no PMREM/mips/GGX; 3 passes converge. Shortcuts within 0.011 per cell: store at 64², or one 256² Gaussian σ 7.4 px renormalised in the face. | Capture once after load (and on team-colour changes in freeplay); clamp to [0, 1]; heavy blur |
| SUR-33 | Cubemap-only hotspots | Ten InterpActors (Circle_Sprite) in layer CubeMapVisibleOnly; InterpActor_14 is HiddenGame [A][M].<br>**How they stay out of the game view:**<br>• Camera mask in the shader: m = 1 at C, 0 once 0.3·\|cam.x\| + 0.59·\|cam.y\| ≳ 64 uu (team versions ~140 uu).<br>• Kismet hides all ten 2.0 s after LevelLoaded.<br>**Plain hotspots** (CubeMap_HotSpot_Mat): rgb 8·(0.533, 0.686, 0.725) = (4.27, 5.49, 5.80), alpha = sat(8·FillFlare.G), mean 0.63; fogged. Big ellipses, as az / el, angular radii (across × up from C, = atan(256·Scale3D.y/d) × atan(256·Scale3D.z/d)), distance:<br>• +X horizon (InterpActor_13): 2° / 2°, 52.7° × 30.4° (across × up), 150k, pitched like InterpActor_12 (from C: el −18.4..37.6). **Not fogged out above the horizon:** the az 0 profile reads 0.40/0.62/0.90/0.37 at el 10–30° with hotspots vs 0.18/0.14/0.09/0.06 without (SUR-35); corrected 2026-10-09<br>• −X: 180° / 7°: InterpActor_2 63.1° × 33.3° (el −24..43), 25k; InterpActor_12 6.1° × 33.7°, 37k, **pitched** 35.7° with its top toward the arena (roll only −1.2°), so from C it spans az 173.0–186.4, el −16.9..47.7 with its major axis vertical (corrected 2026-10-09: ellipses, not circles; a pitch, not a roll about the view axis)<br>• over the ends: +107° / 22°, 60.8° × 30.8°, 14k; −108° / 26°, 50.5° × 22.0° (el 2..45), 15k<br>• ±35° / 15°: 21°, 15k<br>**Orientation, as seen from C** (added 2026-10-10, RVU): each sprite's tilt relative to the line of sight is its world pitch minus the LOS elevation. "Top toward C" values: _13 34.0°, _2 7.7°, _12 28.7°, _3 −7.4°, _5 −15.8°, _0 −5.2°, _7 −5.5°, team blue 26.8°, orange 28.1°. Resulting elevation extents: _13 −18.4..37.6, _2 −23.9..42.6, _12 −16.9..47.7, _3 −10.5..51.0, _5 2.0..44.8, _0 −7.0..35.5, _7 −7.2..36.1, blue −7.3..31.1, orange −6.4..26.4.<br>**Team hotspots** (additive, 8·a²·FillFlare.G·FB): blue at −90° / 9° (26.9° × 20.8°, 8087 uu), orange at +90° / 8° (23.5° × 18.1°, 9421 uu), low over each goal.<br>**HotSpot_Mat** (always visible): a 2.8° glow at az 180.5°, el 10.9°, 490k away (fog replaces it) | Add these glows to our cube capture (camera-masked or capture-only). They dominate the reflections (SUR-35) |
| SUR-34 | What the cube sees by elevation (opaque first hit, all azimuths) | Opaque class fractions, cos-weighted [A], el bands in degrees:<br>• **below −10°:** arena floor 1.00<br>• **−10..−3:** arena 0.48, city 0.23, stands 0.19, props 0.10<br>• **−3..0:** stands 0.39, screens 0.23, city 0.21, props 0.10<br>• **0..3:** stands 0.48, crowd 0.29, city 0.17; sky 0.01<br>• **3..6:** crowd 0.52, stands 0.27, city 0.09; sky 0.07<br>• **6..10:** crowd 0.43, stands 0.16, screens 0.11, city 0.10; sky 0.10<br>• **10..15:** crowd 0.25, city 0.18, stands 0.11, roof 0.09; sky 0.22<br>• **15..20:** city 0.23, crowd 0.14, roof 0.11, structure 0.09; sky 0.29<br>• **20..25:** city 0.29, roof 0.12, crowd 0.11, structure 0.08; sky 0.34<br>• **25..30:** city 0.26, roof 0.14, structure 0.08, lights 0.06; sky 0.40<br>• **30..40:** city 0.17, roof 0.14; sky 0.63<br>• **40..50:** city 0.14; sky 0.86<br>• **50..65:** city 0.07; sky 0.94<br>• **65..90:** sky 0.99<br>By az (reflection_profile.json["opaque_class_fraction"]): the open +X sector (az 0) is sky ≥ 0.73 above el 5° (city below); the end sectors (±90°) are sky ≤ 0.30 up to el 25°.<br>Translucent coverage (1 − transmission): 0.75–0.87 at el −3..25 with hotspots; 0.75 → 0.34 without them (fog band, canopy, cage, fog bowl) | Profile table SUR-35 |
| SUR-35 | Reflection profile: mean colour per az × el | **Cube** (fog [I], hotspots in; LDR = per-pixel min(c, 1); before the 64-px blur). Luminance per sector centre, az 0–330 step 30, then all. **Exact chain** (2026-10-10, CAP1: exact fog FOG-1..15, per-face blur and the sRGB store/sample of SUR-32; data out/bsim/agents/CAP1/reflection_profile_cap1.json; FOG1's and CAL1's σ-12° values are superseded).<br>**Pre-blur "ldr"** (per-pixel min(c, 1) of the converged capture; use it for a pre-blur readback):<br>• −90..−30: .10 .07 .08 .24 .12 .09 .16 .08 .10 .20 .07 .07 \| .11 (arena floor)<br>• −30..−10: .20 .22 .25 .38 .25 .22 .26 .21 .24 .34 .18 .23 \| .25<br>• −10..−3: .22 .18 .28 .29 .27 .16 .13 .18 .29 .29 .24 .16 \| .22<br>• −3..0: .19 .32 .25 .48 .31 .08 .08 .08 .24 .48 .24 .34 \| .26<br>• 0..3: .19 .68 .19 .81 .31 .09 .21 .09 .20 .75 .19 .73 \| .37<br>• 3..6: .26 .78 .35 .96 .65 .24 .29 .15 .22 .85 .24 .87 \| .49<br>• 6..10: .31 .86 .89 1.0 .94 .60 .41 .25 .53 .92 .40 .94 \| .67<br>• 10..15: .41 .94 1.0 1.0 .99 .85 .68 .63 .97 .99 .56 .98 \| .83<br>• 15..20: .63 .98 1.0 1.0 1.0 .87 .97 .72 1.0 1.0 .67 1.0 \| .90<br>• 20..25: .91 .98 .98 .99 1.0 .97 1.0 .85 1.0 1.0 .64 .99 \| .94<br>• 25..30: .38 .75 .78 1.0 1.0 .92 1.0 .86 1.0 1.0 .44 .81 \| .83<br>• 30..40: .06 .12 .44 1.0 1.0 .53 .55 .42 .95 .88 .15 .15 \| .52<br>• 40..50: .05 .06 .07 .49 .49 .12 .14 .12 .17 .14 .06 .06 \| .16<br>• 50..65: .05 .05 .05 .05 .07 .10 .11 .09 .08 .07 .05 .06 \| .07<br>• 65..90: .04 .05 .05 .04 .05 .06 .07 .05 .05 .04 .04 .05 \| .05<br>**"sampled"** (the stored cube as reflective materials see it: blurred per face, stored 8-bit gamma 1/2.2, sRGB-decoded; use it for a readback of the stored/decoded cube):<br>• −90..−30: .10 .07 .08 .23 .12 .09 .16 .08 .11 .20 .07 .07 \| .12 (arena floor)<br>• −30..−10: .20 .21 .24 .37 .24 .22 .25 .20 .24 .33 .18 .22 \| .24<br>• −10..−3: .21 .22 .28 .42 .28 .17 .14 .18 .28 .38 .24 .21 \| .25<br>• −3..0: .20 .47 .26 .67 .34 .11 .13 .11 .24 .55 .24 .50 \| .32<br>• 0..3: .22 .74 .33 .95 .58 .16 .19 .11 .24 .76 .23 .81 \| .44<br>• 3..6: .26 .83 .65 1.0 .93 .41 .29 .16 .37 .88 .31 .92 \| .58<br>• 6..10: .32 .90 .95 1.0 1.0 .76 .45 .31 .78 .97 .46 .97 \| .74<br>• 10..15: .45 .96 1.0 1.0 1.0 .90 .80 .67 1.0 1.0 .62 1.0 \| .87<br>• 15..20: .68 .99 1.0 1.0 1.0 .98 .99 .83 1.0 1.0 .73 1.0 \| .93<br>• 20..25: .84 .99 1.0 1.0 1.0 1.0 1.0 .98 1.0 1.0 .70 1.0 \| .96<br>• 25..30: .44 .86 .86 1.0 1.0 1.0 1.0 1.0 1.0 1.0 .52 .92 \| .88<br>• 30..40: .08 .22 .49 1.0 1.0 .65 .69 .52 .94 .93 .19 .26 \| .58<br>• 40..50: .06 .06 .09 .54 .58 .13 .14 .12 .23 .22 .07 .06 \| .19<br>• 50..65: .05 .06 .06 .06 .07 .10 .11 .09 .08 .07 .05 .06 \| .07<br>• 65..90: .05 .05 .05 .05 .05 .06 .06 .06 .05 .05 .05 .05 \| .05<br>**Colour:** near-white where saturated. The +X sector is bluish (0.32, 0.42, 0.46) at 10–15° (fogged hotspot); −X is warm (0.59, 0.44, 0.35) at 6–10° (sun-side fog); ±90° at 0–3° carries the team hotspots (orange (0.89, 0.82, 0.49), blue mirror).<br>HDR means peak at 3–4 (±90°, el 6–15°). The full RGB tables, the cube_nofog variant and the game-view "mainview" variant are in reflection_profile.json.<br>**Without hotspots** (mainview, no opaque fog), luminance: horizon band 0.16–0.18 (el 0–6°), 0.22–0.25 at el 6–30°, 0.15 at 30–40°, 0.08 at 40–50°, ≤ 0.05 above; the −X sector is warmer and brighter (0.35 at el 6–15°) | Build our cube from our own surroundings plus SUR-33 glows. Check it by binning ours into this table: LDR luminance per az × el within ±0.1 |
| SUR-36 | Bounce and caveats | [I]:<br>• **Repeated captures** [N; field offsets inferred]: 0x140891210, shared by the six capture-component vtables, keeps the capture enabled while CaptureTimeRemaining (+0xa4) > 0, then disables it once a frame count reaches +0xa8; so ≈ 6 captures at 3 Hz within the first 2 s, each reading the previous cube. It converges by capture 1–2. Two gating globals are unidentified.<br>• **Bounce:** the floor needs directional cube lookups (H-1), not a constant. The converged upper-hemisphere LDR mean (blur before the 8-bit store) is 0.64–0.70 (cube_fogI); the old 0.47–0.49 was one bounce. Main-view reflective surfaces sample the captured cube, not their own view (corrected 2026-10-09, CAL1).<br>• **Not modelled:** the 64-px blur and bloom. Thin opaque members (supports, monorail, flags) are over-counted at 0.25° pixels (≤ 2×). Translucent layers use weighted-average OIT with sub-pixel coverage. The arena interior colours are rough (frames 0.40, grass 0.04–0.07).<br>• **Fog:** cube_fogI depends on the SUR-24 constants; cube_nofog is the bracket<br>**Fog constants are now [N]** (2026-10-10, FOG1: constants and the cap read from the exe); the capture-count and blur items stay [I].<br>**G_env corrected (2026-10-10, CAP1):** with the exact per-face blur the converged upper-hemisphere mean is (0.504, 0.528, 0.531) with fog and (0.564, 0.578, 0.575) without, not 0.64–0.70 (the σ-12° blur caused the difference; the encoding moves it < 0.001). The capture starts green, not black (CAL1's F3); the fixed point is unchanged. | Use the profile as a target band, not exact values |

## What can't ship, and stand-ins
Shippable: the formulas and constants above, statistics, curves sampled as short tables, the per-az tables and the
simplified polylines (surroundings_geometry.json), and the reflection profile. Not shippable: meshes, textures,
card positions, per-vertex lighting, and artwork (logos, ads, flags, the statue).

| # | Game asset | Stand-in |
|---|---|---|
| SUR-37 | Stand, roof, canopy, support and plaza meshes | Procedural: revolve SUR-2/SUR-3 profiles; roof band per the SUR-5 table; canopy between the SUR-6 edges; truss ribs every ~10° (SUR-7) |
| SUR-38 | Concrete_CLR, SideWalk01_D, Step_D, Stairs_Pack, Swirls_D, SpecGlow02 cube | Concrete 0.433 + noise (std 0.04) with the g sheen; sidewalk (0.359, 0.332, 0.314) + paving noise (std 0.10); seat ramp 0.12→0.57 then 0.23→0.08; stairs square wave 0.14/0.37, 16 per V; Swirls → noise (mean 0.277, std 0.29); SpecGlow → radial profile (SUR-21) |
| SUR-39 | Crowd cards (positions, vertex colours, baked light) | Generate positions from the tiers; draw r, g, b from our own RNG; light 0.2, or 0.5 on the +X ends. The sphere normal is analytic (n.xy = 0.876·q). No artwork exists: the people are discs |
| SUR-40 | Ads, strips, screen logo, country-flag atlas (artwork) | Strips: alternating 0.8 / 0.07 panels with a 25 % generic emblem. Ads: 0.053 panel with a centred 0.59 emblem (21 % / 11 %). Screens: our own logo at 14 % (uv 0.09–0.93 × 0.35–0.65, colour (0.67, 0.76, 0.85)) with team bars. Flags: procedural tricolours, mean (0.36, 0.32, 0.33) |
| SUR-41 | StadiumLight_D, StadiumLight_Flare, LightCone_Pack, FillFlare, Curve_Fire_Color_01, Curve_FogDusk_01 | Floodlights: procedural cell mask, 11 % bright cells, 0.04 elsewhere, × the SUR-12 row formula. FillFlare radial G at r = 0, 0.1, …, 0.9: 1.0, 0.97, 0.91, 0.81, 0.67, 0.49, 0.31, 0.15, 0.04, 0.01. Curves as the SUR-23 tables (mat_lights/profiles.json) |
| SUR-42 | City (Building_A_Pack, OOBCube, CityLights_01_Pack) and skyline meshes | Boxes on the SUR-11 footprints with a procedural window grid tuned to (0.20, 0.17, 0.11); ground glow v·(0.748, 0.574, 0.265) toward the rim |
| SUR-43 | Statue mesh, tree branch atlas, banner art, arrow art | Grey figure on a plinth; noise-masked foliage cards (43 % coverage, colours SUR-20); team-colour flags with a stripe; procedural chevrons |
| SUR-44 | Noise textures in the sky and materials (Noise_Smoke_03, Generic_01/02, Fire_02, Shapes_01) | Generic value noise matched to the texture means (e.g. Shapes_01 R lin 0.225) |

## Open
- **Fog constants (SUR-24):** the /1000 scaling, the terminator exponent and the main-view near plane are [I].
  - A native read of the fog parameter setup would settle them (the shader parameter names are stripped from the exe).
  - So would a live screenshot: are the far stands visibly fogged in game?
- **Capture timing:** whether the freeplay ForceRecaptureScene happens within the 2 s hotspot window is unverified. A
  later freeplay re-capture would drop the hotspots.
- **Local OBJs** (git-ignored, game-derived, never ship): out/bsim/assets_local/arena/meshes/sur1/. 28 surroundings
  meshes in world placement with full pitch/yaw/roll, written by SUR1/place.py (AV1's export_obj.py handles yaw only).

---

## Height fog (FOG-1..15, 2026-10-10)

Requested by the user (RV-129; relayed by tmp-6f). Drafted by sub-agent FOG1 (decompiles local in
out/bsim/agents/FOG1/work/). The static session re-checked the inscatter exponent in FUN_140a1b670 (line 164:
`p = -0.30103 / logf(0.5 - 0.5·cos θ)`, a log10 constant over a natural log, = 0.0921).

### Rows

| # | Item | Spec | Tag |
|---|---|---|---|
| FOG-1 | Fog actor | **ExponentialHeightFog_0** at (12001.7, 904.0, 6783.999), Rotation (Pitch −2131, Yaw −32905, Roll 2467).<br>Component values:<br>• FogHeight 6783.999<br>• FogDensity 0.075<br>• FogMaxOpacity 0.9<br>• StartDistance 10240<br>• LightTerminatorAngle 22.5<br>• OppositeLightColor (121, 189, 218), OppositeLightBrightness 0.15<br>• LightInscatteringColor (255, 153, 0)<br>Class defaults that are not overridden: FogHeightFalloff 0.2, LightInscatteringBrightness 1.0, bEnabled true.<br>This engine version has no directional-inscattering exponent or start distance: the component has only the fields above. No other fog actor or HeightFog layer exists. The streamed sublevel stadium_oob_audio_map holds no lights or fog | [A] |
| FOG-2 | Scene info (CPU) | FUN_140a667d0, the FExponentialHeightFogSceneInfo ctor, called from FUN_140a4a4c0 ("FAddFogCommand"; Scene+0x5e70, 0x50-byte entries). It stores:<br>• FogHeight<br>• Density/1000 = **7.5e-5**<br>• Falloff/1000 = **2.0e-4**<br>• MaxOpacity, Start, TerminatorAngle<br>• **Opp** = FLinearColor(OppositeLightColor)·OppositeLightBrightness<br>• **Ins** = FLinearColor(LightInscatteringColor)·LightInscatteringBrightness<br>• **LightVector** = Owner.Rotation.Vector(), or (0, 0, 1) without an owner.<br>FLinearColor(FColor) is FUN_1402d2490, a 256-entry table at 0x14225fd70 holding **(i/255)^2.2**, plus alpha/255 | [N] |
| FOG-3 | View constants | FUN_140a1b670 (InitFogConstants) runs per view per frame:<br>• **Cd = Density/1000 · 2^(−(Falloff/1000)·(ViewOrigin.Z − FogHeight))**<br>• f = Falloff/1000<br>• p = −0.30103 / ln(0.5 − 0.5·c), with c = clamp(cos(Angle·π/180), −0.99999, 0.99999). The log is the CRT logf (natural log, IAT import api-ms-win-crt-math logf); −0.30103 is a constant at 0x141cd5abc.<br>• Start<br>• Opp; Ins; LightVector; MaxOpacity.<br>Shader parameter packing (FUN_140a3a540 for the PS; FUN_1409f1120 for the base-pass VS):<br>• P0 = (Cd, f, p, Start)<br>• P1 = (Opp.rgb, **1 − MaxOpacity**)<br>• P2 = Ins.rgb<br>• P3 = LightVector.<br>In the fog PS these sit at cb0[4..7]; the GSC record's parameter map binds them at bytes 0x40/0x50/0x60/0x70 [M] | [N][M] |
| FOG-4 | Light vector | FUN_140a1b670 scans Scene lights for **LightType == 3**. GetLightType returns 3 for DominantDirectionalLightComponent (FUN_14028e3f0) and 2 for DirectionalLightComponent (FUN_14028e420). If one is found, it uses −(WorldToLight.M[0][2], M[1][2], M[2][2]) (FLightSceneInfo +0x48/+0x58/+0x68). Otherwise it uses the fog actor's vector.<br>Stadium_P (and every package loaded in a match) has **no** dominant directional light: the sun DirectionalLight__LC_1 is type 2, and no native code constructs one. So **L = Rotation(−2131, −32905, 2467).Vector() = (−0.97909, 0.01314, −0.20298)**: az 179.23°, el −11.71°, pointing at the −X horizon (via the GMath sine table, FUN_140369b10/FUN_14038a5d0). In three.js axes (x, z, y): (−0.97909, −0.20298, 0.01314) | [N][A] |
| FOG-5 | Constants (final) | **Cd(z) = 7.5e-5·2^(−2e-4·(z − 6783.999))**, giving 1.6890e-4 at the capture (z 927.9998) and 1.916e-4 at z 17.<br>**f = 2.0e-4**; **Start = 10240**; **F_min = 1 − 0.9 = 0.1**; **p = 0.0920979**.<br>**Opp = 0.15·(0.19397, 0.51740, 0.70830) = (0.029096, 0.077610, 0.106245)**.<br>**Ins = (1, 0.325037, 0)** | [N][A] |
| FOG-6 | Shader maths | Identical in the opaque fog PS (GlobalShaderCache TExponentialHeightFogPixelShader<…>) and in every fog-enabled translucent base-pass VS (e.g. FogHemisphere_V2, FogSheet, StadiumFog incl. particle sprite/SubUV/beam VFs, HexGlass, TrimLight). **Δ = receiver − camera**, dist = \|Δ\|, then:<br>• ez = (\|Δz\| > 0.01 ? Δz : 0.01)<br>• line = Cd·max(dist − Start, 0)·(1 − 2^(−f·ez))/(f·ez)<br>• **F = max(min(2^(−line), 1), F_min)**<br>• **t = \|0.5 − 0.499·dot(L, Δ/dist)\|^p**<br>• **colour = Ins + t·(Opp − Ins)** (t → 1: Opp; t small: Ins)<br>• Output (premultiplied): rgb = (1 − F)·colour, a = F. Opaque pass blend: scene·F + rgb (depth test LessEqual against a quad placed at the StartDistance depth, no depth write) | [M][N] |
| FOG-7 | Inscatter shape | Weight of the orange (1 − t) at angle θ from L:<br>• 0.47 at 0°; 0.42 at 5°; 0.35 at 10°; **0.26 at 22.5°**; 0.16 at 45°; 0.06 at 90°; 0.015 at 135°; 0 at 180°.<br>A broad, weak warm glow centred just below the −X horizon. Overhead t = 0.954 (95 % Opp).<br>The exe mixes log bases: p puts t = 0.74, not 0.5, at the terminator angle. The exe is the reference | [N] |
| FOG-8 | Opaque depth seen by the fog PS | The PS clamps deviceZ to 0.999. **SceneDepth = 1/(d·(1/M32) − (M22/M32 − 1e-8))**. That is View+0x528/0x52c from FUN_140a55230 (FViewInfo init), uploaded as PS cb2[1].zw by the D3D11 RHI (FUN_140db87d0). The inverted-Z flag DAT_1424a5400 is never written, so the depth clears to 1.0 (FUN_140a6c1e0).<br>• **Main view:** CalcSceneView (FUN_140817df0) builds FPerspectiveMatrix with MinZ = MaxZ = GNearClippingPlane in both branches (FUN_140816b30 / FUN_14069df40). So M22 = 0.999 and M32 = −0.999·near: an **infinite far plane**. deviceZ never exceeds 0.999 and SceneDepth = z/(1 + 1e-8·z). There is **no cap**; the background maxes at 1e8.<br>• **GrassCube:** FUN_1408628c0 builds a 90° projection with M22 = Far/(Far − Near), M32 = −Near·M22 (Near 32, Far 9,999,999). The clamp gives **SceneDepth ≤ 31,887 uu** of view depth along the face axis | [N] |
| FOG-9 | Near plane | GNearClippingPlane is DAT_142260448, initial **10.0**, read from [Engine.Engine] NearClipPlane (FUN_1406b2c80). Nothing writes it at run time. The snapshot ships no engine ini (Coalesced_INT holds only .int files), so it is 10 unless a user ini overrides it. **The fog does not depend on it** (FOG-8) | [N][I] |
| FOG-10 | Where fog applies | • **Opaque World-DPG geometry** (arena, stands, roof, city, sky dome): fog pass FUN_140a2f620. It runs per perspective view (ViewOrigin.W > 0) if ShowFlags have Fog (0x20) and 0x200000000000 (FUN_140a3f2a0), in DPG 1 only. Foreground DPG (lens flares) is not fogged.<br>• **Light shafts never absorb the fog:** the light-shaft helper FUN_140a109c0 always returns 0, so view flag 0x40 stays clear and the separate pass always runs.<br>• **Inside the arena** (dist < 10,240) nothing is fogged.<br>• **Translucent materials:** per-vertex fog in the base-pass VS (FUN_1409f1120). It uses the true vertex distance, **no cap**, interpolated across triangles. PS blends: translucent c·F + fog.rgb; additive c·F (e.g. Glow02_Mat); modulate lerp(1, c, F).<br>• **Particles:** same vertex fog (sprite, SubUV and beam VFs carry the fog code).<br>• **Sky dome** (SkyDome_MAT, opaque, no vertex fog): fogged by the opaque pass.<br>• **Fog hemisphere** (FogHemisphere_V2, translucent): see H-10 below | [N][M] |
| FOG-11 | GrassCube capture | Fog is on: bEnableFog keeps show flag 0x20 (FUN_140878200, component bit 4).<br>• Camera: ViewOrigin = (0, 0, 927.9998), so **Cd = 1.6890e-4**.<br>• Near 32, Far 9,999,999; opaque fog capped at 31,887 uu view depth (FOG-8).<br>• Translucent layers in the cube take vertex fog at their true distance.<br>• The fog uses the same L, p and colours as the main view | [N][A] |
| FOG-12 | Ordering | The fog pass runs inside FUN_140a79750 (the World-DPG pass after the opaque/decal work), before that function's later passes (FUN_140453070, FUN_140aaac50, FUN_140a7b120, which are unidentified). It reads only scene depth. Translucency fogs itself per vertex, so its order relative to the fog pass does not change the maths. Where the shafts pass sits relative to fog is still PP1's [I] | [N][I] |
| FOG-13 | Capture contribution by band | See table T1 (fog pass alone) and T2 (full recomposition, CAL1 method with exact fog). **El 65–90: fog adds rgb (0.0259, 0.0307, 0.0348), lum 0.030; sky transmitted × 0.656.** Net +0.019 over no fog (LDR 0.049 vs 0.030) | [I] (geometry/compose from SUR1/CAL1), fog maths [N] |
| FOG-14 | Main view: far stands | **Yes, fogged.** Fog starts at 10,240 uu and grows with distance.<br>F at the same height: 0.85 at 12k, 0.71 at 14k, 0.59 at 16k, 0.41 at 20k, 0.26 at 25k, 0.17 at 30k, floor 0.1 beyond ≈ 37k.<br>From the kickoff car cam (0, −4890, 130), mean over visible surfaces:<br>• stands: 80 % fogged, F 0.70 (p10 0.45), added lum 0.032<br>• crowd: F 0.64<br>• roof: F 0.55<br>• city: F 0.23<br>Sky: F 0.52 at the zenith (z 130); F 0.1 below el ≈ 15–17°. Table T3 | [N] maths, [I] surface set (C's first hits) |
| FOG-15 | Client | GLSL below. Use exact formulas, not three.js Fog. Evaluate from world positions: main view uncapped; cube capture capped at 31,887 view depth for opaque pixels; translucent per vertex. The sky uses RL's dome distance | [N] |

**Evidence for the translucent vertex-fog path (2026-10-10, DXB1) [M][N]:** `ne r, cb0[73].x, 0; if_nz r` (register
74/67/78/82 depending on the vertex factory) selects the exponential fog; the else is UE3's 4-layer height fog.
FUN_1409f1120 sets that flag to 1.0 when View+0x12e8 bit 0 is set (FUN_140a1b670 sets it when an exponential fog
exists). All 160 translucent VS fog branches have this shape.

### Applied elsewhere

The SUR-24 replacement and the corrections to SUR-23/25/32/35/36, AV-19, H-10 and PP-17 are applied in their rows
(2026-10-10).

### T1 — fog pass alone in the GrassCube, from C (cos-weighted means, all azimuths)

F = transmittance applied to the scene behind, add = (1 − F)·colour added. lum = 0.3R + 0.59G + 0.11B (SUR-35 weights; Rec.709 differs by < 0.001).
- "geometry" uses SUR1's first-hit depths (stands, city, sky).
- "sky only" assumes every upward ray reaches the dome; it is the clean target for a client sky.

| el band | F (geometry) | add rgb (geometry) | add lum | lum az 0 / az 180 | F (sky only) | add lum (sky only) |
|---|---|---|---|---|---|---|
| −90..−10 | 1.000 | 0 | 0 | 0 / 0 | 1.000 | 0 |
| −10..−3 | 0.760 | (0.024, 0.023, 0.024) | 0.023 | 0.029 / 0.026 | 0.760 | 0.023 |
| −3..0 | 0.708 | (0.024, 0.027, 0.029) | 0.026 | 0.045 / 0.043 | 0.708 | 0.026 |
| 0..3 | 0.661 | (0.031, 0.032, 0.034) | 0.032 | 0.049 / 0.060 | 0.150 | 0.091 |
| 3..6 | 0.596 | (0.044, 0.040, 0.039) | 0.041 | 0.052 / 0.092 | 0.183 | 0.086 |
| 6..10 | 0.496 | (0.056, 0.050, 0.049) | 0.051 | 0.049 / 0.101 | 0.225 | 0.081 |
| 10..15 | 0.459 | (0.058, 0.053, 0.053) | 0.054 | 0.046 / 0.101 | 0.276 | 0.074 |
| 15..20 | 0.448 | (0.058, 0.054, 0.054) | 0.055 | 0.043 / 0.101 | 0.330 | 0.067 |
| 20..25 | 0.458 | (0.054, 0.052, 0.054) | 0.053 | 0.040 / 0.089 | 0.378 | 0.061 |
| 25..30 | 0.490 | (0.048, 0.048, 0.051) | 0.048 | 0.038 / 0.077 | 0.419 | 0.056 |
| 30..40 | 0.515 | (0.044, 0.045, 0.048) | 0.045 | 0.035 / 0.063 | 0.470 | 0.050 |
| 40..50 | 0.531 | (0.040, 0.043, 0.047) | 0.043 | 0.033 / 0.056 | 0.531 | 0.043 |
| 50..65 | 0.602 | (0.032, 0.036, 0.040) | 0.035 | 0.029 / 0.043 | 0.602 | 0.035 |
| **65..90** | **0.656** | **(0.0259, 0.0307, 0.0348)** | **0.030** | 0.027 / 0.033 | 0.656 | 0.030 |

### T2 — full recomposition (CAL1 recompose with the exact fog; capture 5, blur σ 12°, LDR, lum per band, all az)

| el band | cube, exact fog | cube, old [I] fog (CAL1) | cube, no fog | main view from C, no opaque fog (old) | **main view from C, with opaque fog** |
|---|---|---|---|---|---|
| −90..−30 | 0.147 | 0.147 | 0.170 | 0.151 | 0.147 |
| −30..−10 | 0.258 | 0.259 | 0.268 | 0.258 | 0.258 |
| −10..−3 | 0.256 | 0.254 | 0.421 | 0.244 | 0.243 |
| −3..0 | 0.260 | 0.260 | 0.463 | 0.185 | 0.184 |
| 0..3 | 0.366 | 0.366 | 0.513 | 0.162 | 0.158 |
| 3..6 | 0.484 | 0.486 | 0.617 | 0.178 | 0.170 |
| 6..10 | 0.667 | 0.674 | 0.781 | 0.236 | 0.217 |
| 10..15 | 0.831 | 0.837 | 0.914 | 0.250 | 0.229 |
| 15..20 | 0.903 | 0.907 | 0.937 | 0.251 | 0.220 |
| 20..25 | 0.941 | 0.941 | 0.960 | 0.232 | 0.199 |
| 25..30 | 0.829 | 0.830 | 0.884 | 0.258 | 0.213 |
| 30..40 | 0.521 | 0.531 | 0.546 | 0.160 | 0.149 |
| 40..50 | 0.164 | 0.169 | 0.164 | 0.083 | 0.093 |
| 50..65 | 0.068 | 0.065 | 0.054 | 0.052 | 0.072 |
| **65..90** | **0.049** (0.045, 0.051, 0.054) | 0.043 | 0.030 | 0.027 | **0.057** |

**Cube, exact fog, by sector** (az 0–330 step 30 | all), replacing SUR-35's cube table:

| el band | luminance by sector |
|---|---|
| −90..−30 | .13 .09 .11 .31 .13 .12 .20 .10 .12 .27 .09 .09 \| .15 |
| −30..−10 | .21 .23 .26 .38 .25 .23 .27 .22 .24 .34 .23 .23 \| .26 |
| −10..−3 | .24 .21 .31 .33 .30 .20 .15 .22 .31 .33 .28 .18 \| .26 |
| −3..0 | .20 .31 .25 .50 .31 .08 .09 .08 .24 .48 .24 .33 \| .26 |
| 0..3 | .20 .67 .19 .80 .31 .09 .21 .09 .20 .72 .19 .72 \| .37 |
| 3..6 | .26 .78 .35 .95 .65 .24 .29 .15 .22 .81 .24 .87 \| .48 |
| 6..10 | .31 .86 .89 1.0 .94 .60 .42 .25 .53 .89 .40 .94 \| .67 |
| 10..15 | .40 .94 .99 1.0 .99 .85 .68 .63 .97 .99 .55 .98 \| .83 |
| 15..20 | .62 .98 1.0 1.0 1.0 .87 .97 .73 1.0 1.0 .67 1.0 \| .90 |
| 20..25 | .90 .98 .98 .99 1.0 .97 1.0 .85 1.0 1.0 .64 .99 \| .94 |
| 25..30 | .38 .74 .78 1.0 1.0 .93 1.0 .88 1.0 1.0 .44 .81 \| .83 |
| 30..40 | .06 .12 .43 1.0 1.0 .53 .56 .42 .95 .88 .15 .15 \| .52 |
| 40..50 | .05 .06 .07 .48 .49 .12 .14 .12 .17 .14 .06 .06 \| .16 |
| 50..65 | .05 .05 .05 .05 .07 .10 .11 .09 .08 .07 .05 .06 \| .07 |
| 65..90 | .04 .05 .04 .04 .05 .06 .07 .05 .05 .04 .04 .05 \| .05 |

Converged upper-hemisphere G_env: (0.634, 0.692, 0.702).

### T3 — main view, is it fogged? (fog from game cameras on the surfaces C sees)

| camera | stands F (fogged share) | crowd F | roof F | city F | sky F at el 20 / 45 / 90 |
|---|---|---|---|---|---|
| centre (0, 0, 928) | 0.74 (100 %) | 0.66 | 0.58 | 0.25 | 0.18 / 0.44 / 0.56 |
| kickoff car cam (0, −4890, 130) | 0.70 (80 %) | 0.64 | 0.55 | 0.23 | 0.15 / 0.40 / 0.52 |
| corner (−3500, −4500, 200) | 0.74 (75 %) | 0.66 | 0.58 | 0.23 | 0.15 / 0.40 / 0.52 |

Zenith add (lum) by camera height: 0.042 (z 17), 0.040 (z 300), 0.038 (z 928), 0.034 (z 2000). Toward −X at el 5–10° the sky fog reads lum 0.16–0.17 (warm); toward +X 0.06.

### FOG-15 — client shader chunk (three.js, custom; not THREE.Fog)

In RL world units (uu) and RL axes (z up). For the client's axes (three x, y-up, z) = (RL x, RL z, RL y), swap the vertical and the y component as noted.

```glsl
// uniforms updated per camera (main camera and each cube-face camera)
uniform vec3  uFogCam;      // camera world position (uu), three axes
uniform float uFogCd;       // 7.5e-5 * exp2(-2.0e-4 * (camHeight - 6783.999))  (camHeight = RL z = three y)
uniform float uFogCap;      // view depth where deviceZ hits 0.999: 1e30 main view, 31897.44 GrassCube faces (-> SceneDepth <= 31887.3)
uniform vec3  uFogAxis;     // view forward axis (for the cap); cube face axis in the capture
const float FOG_F     = 2.0e-4;
const float FOG_START = 10240.0;
const float FOG_FLOOR = 0.10000002;                    // 1 - FogMaxOpacity
const float FOG_P     = 0.0920979;
const vec3  FOG_L     = vec3(-0.9790941, -0.2029826, 0.0131425);   // three axes (RL (-0.97909, 0.01314, -0.20298))
const vec3  FOG_OPP   = vec3(0.0290958, 0.0776102, 0.1062447);
const vec3  FOG_INS   = vec3(1.0, 0.3250370, 0.0);

// delta = receiver - camera (three axes, uu). Returns (premultiplied fog colour, F).
vec4 rlHeightFog(vec3 delta) {
  float dist = length(delta);
  float dz   = delta.y;                                  // vertical (RL z)
  float ez   = abs(dz) > 0.01 ? dz : 0.01;
  float fz   = FOG_F * ez;
  float line = uFogCd * max(dist - FOG_START, 0.0) * (1.0 - exp2(-fz)) / fz;
  float F    = max(min(exp2(-line), 1.0), FOG_FLOOR);
  float t    = pow(abs(0.5 - 0.499 * dot(FOG_L, delta / max(dist, 1e-3))), FOG_P);
  return vec4((1.0 - F) * mix(FOG_INS, FOG_OPP, t), F);
}
// opaque (incl. sky): cap the view depth like the exe, then  c.rgb = c.rgb * fog.a + fog.rgb
vec3 rlOpaqueDelta(vec3 worldPos) {
  vec3 d = worldPos - uFogCam;
  float z = dot(d, uFogAxis);                            // view depth
  float s = min(z, uFogCap) / max(z, 1e-6);
  return d * s / (1.0 + 1e-8 * min(z, uFogCap));         // exe: SceneDepth = z/(1+1e-8 z), clamped
}
// translucent/particles (per vertex, no cap): alpha-blend c*F + fog.rgb; additive c*F; modulate mix(vec3(1), c, F)
```

Notes for the client:
- **Sky:** RL's dome is 8,388,608 × 5,033,165 uu. Feed the sky pixels delta = D·r(D), with r(D) = 1/√((Dx² + Dz²)/8388608² + Dy²/5033165²) in three axes. Equivalently, for Dy > 0, line → Cd·(1 − 10240/r)/(f·Dy) (saturated). The client's own sky-mesh distance must not be used.
- **Cube capture:** camera at C = (0, 927.9998, 0) in three axes, uFogCd = 1.68899e-4, uFogCap = 31897.44 (pre-division; SceneDepth tops out at 31,887.3), uFogAxis = the face's axis. Translucent layers use uncapped vertex fog. Check against T1 (fog only) and T2 (whole capture).
- **Main view:** uFogCap = 1e30, with uFogCd recomputed every frame from the camera height. Nothing inside the arena changes (dist < 10,240).
- **Float32:** fz < −128 cannot occur while dist < 10,240, and line = ∞ gives F = floor. This needs no extra guard; the exe has none.

### Evidence (live addresses)

- **Package and shaders:**
  - Package [A]: Stadium_P.upk ExponentialHeightFog_0 / ExponentialHeightFogComponent_0; Engine.upk Default__ExponentialHeightFogComponent; Stadium_P has 3 DirectionalLightComponents, 0 DominantDirectional; stadium_oob_audio_map has no lights.
  - GSC [M]:
    - TExponentialHeightFogPixelShader<MSAASF_NoMSAA> blob @1915061 (1324 B).
    - Its parameter map after the blob: (buffer 0, base 0x40/0x50/0x60/0x70, 16 B each).
    - Translucent VS fog: FogHemisphere_V2_Mat base-pass VS (AV1/sc2); particle VFs in StadiumFog_Team1_MIC.
- **Fog scene info and parameters:**
  - Scene info: FUN_140a4a4c0 (add, "FAddFogCommand", vtable 0x141cd8a60), FUN_140a667d0 (ctor).
  - Conversions: FUN_1402d2490 + table 0x14225fd70 (gamma 2.2); FUN_14038a5d0/FUN_140369b10 (Rotator.Vector).
  - View constants: FUN_140a1b670 (InitFogConstants; logf import 0x141a3f0c0, cosf, powf; constants 0.5, ±0.99999, −0.30103).
  - Lights: FUN_140a43510 (FLightSceneInfo ctor: +0x40 WorldToLight, +0x150 = GetLightType vslot 0x300). GetLightType 2/3: FUN_14028e420 / FUN_14028e3f0 (vtables 0x141b3e538 / 0x141b3e890).
  - Shader setters: FUN_140a3a540 (PS); FUN_1409f1120 (VS; called by FUN_140a17df0 … FUN_140a19760); FUN_140a3aae0 (fog quad VS, depth of StartDistance).
- **Fog pass:**
  - FUN_140a2f620 (fog pass; flag 0x40 test, ViewOrigin.W > 0, DPG 1), FUN_1409f1f10/2330/2750 (bound shader states).
  - FUN_140a3f2a0 (ShouldRenderFog); FUN_140a2edc0 / FUN_140a109c0 (light shafts; returns 0); FUN_140a79750 (caller).
- **Depth and projection:**
  - FUN_140817df0 (CalcSceneView; FPerspectiveMatrix args MinZ = MaxZ = [0x142260448] at 0x14081845f..0x14081846d).
  - FUN_140816b30 / FUN_14069df40 (perspective matrices, 0.999).
  - FUN_140a55230 (InvDeviceZToWorldZ = (1/M32, M22/M32 − 1e-8); inverted-Z flag 0x1424a5400, only read here and in FUN_140a6c1e0).
  - FUN_140db87d0 (D3D11 view CB: PS cb2[1] = View+0x520..0x52c).
  - FUN_1406b2c80 ([Engine.Engine] NearClipPlane → 0x142260448, init 10.0).
- **GrassCube:** FUN_1408678c0 (cube probe from component, vtable 0x141c65500), FUN_1408628c0 (cube projection: tan(π/4), Near probe+0x9c, Far probe+0xa0), FUN_140878200 (capture show flags; bEnableFog keeps 0x20).
- **Tools/outputs (local, FOG1/):**
  - Models and tables: fog_exact.py (model), band_tables.py → fog_bands.json (T1), recompose_fog1.py → reflection_profile_fog1.json (T2), mainview_stands.py → mainview_stands.json (T3), fog_constants.json.
  - Raw reads: work/ (decompiles, scans).

### Open questions

1. **Shafts order:** where the light-shaft pass sits relative to the fog pass (PP-17) is unverified. It affects only whether shaft bloom sees fogged colour.
2. **User-ini overrides:** the near plane could be overridden by a user ini (irrelevant to fog). The fog actor/component could only be changed by Kismet (none found; the actor is bStatic).
3. **Main-view surfaces:** T3 uses the surfaces visible from C, not a re-raycast from each camera. The F values are right per surface, but the visible set from a low car camera differs (fewer roof and city pixels).
4. **Fog hemisphere vertices:** the hemisphere's per-vertex fog depends on its vertex placement. SUR1's samples interpolate per sample, not per vertex; with large triangles the exe's linear interpolation of vertex fog can differ near the rim.
