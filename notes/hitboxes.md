# Hitbox presets: our names

Shipped files (the web client's bundle, the engine's WebAssembly, the server image) name no game (the user's decision,
2026-10-15): the six hitbox presets go by their shape. The engine's preset ids are the same; RocketSim's own C++
identifiers (`CAR_CONFIG_OCTANE` …) stay in its sources and the bindings' (they don't survive into the WebAssembly, and
the image's server binary is stripped of symbols).

| id | ours (client `CarBody`) | the game's preset | its shape (RocketSim's hitbox, uu: length × width × height) |
|----|-------------------------|-------------------|--------------------------------------------------------------|
| 0  | Standard                | Octane            | 120.5 × 86.6 × 38.6, the all-round car                       |
| 1  | Flat                    | Dominus           | 130.4 × 85.5 × 33.9, long and low                            |
| 2  | Wide                    | Plank             | 131.3 × 87.2 × 31.3, the widest and flattest                 |
| 3  | Long                    | Breakout          | 134.0 × 83.3 × 32.8, the longest, narrow                     |
| 4  | Mid                     | Hybrid            | 129.5 × 84.7 × 34.2, between Standard and Flat               |
| 5  | Tall                    | Merc              | 123.2 × 79.2 × 44.1, the tallest                             |

The same decision renamed the two quick-chat presets naming the game: "This is Rocket League!" is "This is Carball!"
(Group6Message4) and "This isn't Rocket League!" is "This isn't Carball!" (Group3Message14); the page's title is
"Carball".

## Body proportions on the presets (garage stand-ins; scalars only)

Measured 2026-10-16 by the static session (CM1, `out/bsim/agents/CM1/measure.py`, local) from the local exports
(out/bsim/assets_local/cars, fennec), in `client/src/render/carModel.ts`'s FENNEC field set, for the garage's stand-in cars
"based on the octane, dominus, and merc" (the user's request; the user's rule: measured scalars only, the styling ours, no
outlines). The same script re-measures the Fennec: 25 of 30 FENNEC values within 0.1 uu; windscreenBase −0.16, halfWidthNose
+0.20, clearance −0.21, belt −0.27, halfWidthTail +0.37, halfWidthBelt −0.44 (FENNEC's 32.4 is the plan waist at the
windscreen base); **hood −1.42**: FENNEC.hood 38.4 isn't on the Fennec's geometry (the windscreen base on the centreline is 37.0,
the cowl top 37.4), so use 37.0 (or FENNEC_CM1) for consistency.

Frame as FENNEC's: uu, the car (physics body) frame in three.js axes (x forward, y up, z right), each car on its own preset's
hitbox; heights h above `ground` = the mean of the four bind-pose visual tyre bottoms. Wheels: the manifest's visual centres
(z the mean of left and right), radius R·16.313/16, width W·14.529/15.

```ts
export const OCTANE = { // hitbox Standard
  front: 78.0, rear: -51.7, ground: -19.1, halfWidth: 36.3, halfWidthBelt: 22.6, halfWidthRoof: 13.4, halfWidthNose: 18.5,
  halfWidthTail: 31.9, clearance: 9.8, noseTop: 22.9, hood: 34.5, belt: 33.3, roof: 52.0, windscreenBase: 45.5,
  windscreenDeg: 33.1, roofFront: 31.0, roofBack: -2.2, rearWindowBase: [-2.2, 38.5] as const, bumperTop: 20.1,
  frontWheel: { x: 51.3, h: 13.2, z: 26.5, radius: 12.7, width: 11.1 },
  backWheel: { x: -34.3, h: 14.8, z: 29.6, radius: 15.3, width: 12.6 },
} as const;
export const DOMINUS = { // hitbox Flat
  front: 89.7, rear: -61.1, ground: -19.4, halfWidth: 36.3, halfWidthBelt: 27.6, halfWidthRoof: 16.8, halfWidthNose: 18.9,
  halfWidthTail: 33.9, clearance: 3.4, noseTop: 21.5, hood: 31.4, belt: 31.5, roof: 42.8, windscreenBase: 27.0,
  windscreenDeg: 29.4, roofFront: 7.9, roofBack: -34.5, rearWindowBase: [-46.2, 36.5] as const, bumperTop: 22.0,
  frontWheel: { x: 50.4, h: 13.2, z: 31.1, radius: 12.2, width: 14.5 },
  backWheel: { x: -35.2, h: 13.3, z: 32.9, radius: 14.3, width: 14.5 },
} as const;
export const MERC = { // hitbox Tall
  front: 72.7, rear: -63.0, ground: -22.4, halfWidth: 34.5, halfWidthBelt: 29.3, halfWidthRoof: 25.0, halfWidthNose: 29.9,
  halfWidthTail: 32.5, clearance: 15.1, noseTop: 30.7, hood: 49.4, belt: 47.9, roof: 67.8, windscreenBase: 48.0,
  windscreenDeg: 46.9, roofFront: 37.9, roofBack: -57.8, rearWindowBase: [-57.8, 60.0] as const, bumperTop: 43.2,
  frontWheel: { x: 38.2, h: 14.8, z: 31.7, radius: 15.3, width: 14.0 },
  backWheel: { x: -39.8, h: 16.8, z: 31.7, radius: 16.3, width: 14.5 },
} as const;
```

Definitions (CM1; "shell" = the body material, not the chassis or lenses): belt = the side glass's lowest visible point;
front/rear = the outermost x below roof − 3 where the shell is present or the section is ≥ half the car's width (narrow add-ons
listed separately); halfWidth = max \|z\| of all geometry without wheels; halfWidthBelt = the section at h = belt over the side
glass's x range; halfWidthRoof = the shell's section at roof − 3; halfWidthNose/Tail = sections at front − 4 / rear + 4;
clearance = the lowest point between the arches; noseTop = the shell's max h 0.5 behind its foremost point; hood = the
windscreen base's h on the centreline; roof = the opaque shell's max h on the centreline (rear + L/4 to roofFront);
windscreenBase/roofFront = the visible windscreen's max/min x; windscreenDeg = its least-squares rake within \|z\| < 10;
roofBack = the rearmost x of the roof region at h ≥ roof − 3 connected to the peak; rearWindowBase = (min x, min h) of the
non-side glass behind the side glass; bumperTop = the shell's max h below the belt at rear + 2…3.

**Fields that don't transfer cleanly:**
- rearWindowBase on cars with no rear glass (Octane, Merc) is the foot of the cabin's back: Octane (−2.2, 38.5), the
  upright cabin back meeting the engine deck; Merc (−57.8, 60.0), the back panel's top under the roof lip.
- bumperTop: Octane 20.1 is the diffuser between open rear fenders (silhouette tail top 43.2); Dominus 22.0 is the valance
  (ducktail lip 38.6, trunk lid 35.3: use 38.6); Merc 43.2 is on the upright back panel. carModel's `hatchAtBelt` divides by
  (rearWindowBase.h − bumperTop): with the Octane's tail top (43.2 > 38.5) that formula breaks, so the Octane's rear needs
  its own handling.
- noseTop: Merc 30.7 is the bumper/grille top (x 72.2); the bonnet's front edge is at x ≈ 66.7, h 42.2 (a stepped nose).
  Dominus 21.5 is the beak's tip.
- The Octane and Merc windscreens end well below the roof (Octane top 43.1 vs roof 52.0 rising to x 0; Merc 58.9 under a
  62.4 brow): use windscreenTopH, roofFrontH and roofPeakX below for the real roof line.
- clearance: Dominus 3.4 is a centre undertray (side sills ≈ 4.3–5.4); Octane 9.8 is the side blade (floor ≈ 13.6–14.2).
- The Octane's wheel pods (waist 20.9 vs fenders 31.9/36.3) and narrow canopy don't fit an extruded box.

**Extra named measures** (Fennec / Octane / Dominus / Merc):

| Measure | Fennec | Octane | Dominus | Merc |
|---|---|---|---|---|
| length = front − rear | 140.4 | 129.7 | 150.8 | 135.7 |
| lengthOverall (add-ons, wing) | 140.4 | 140.0 | 151.3 | 145.9 |
| frontOverall / rearOverall | 78.0 / −62.4 | 79.6 tow hook / −60.4 wing | 89.7 / −61.6 | 77.5 light bar / −68.4 spare wheel |
| width | 71.4 | 72.6 | 72.5 | 69.1 |
| top: max h (at x) | 52.3 lip (−52.3) | 62.7 wing (−59.8) | 42.8 (−4.1) | 72.0 lip (−57.6) |
| shellFront / shellRear (below belt) | 78.0 / −62.4 | 74.5 / −27.6 | 89.7 / −58.6 | 72.7 / −58.7 |
| wheelbase visual (physics) | 85.3 (85.0) | 85.6 (85.0) | 85.6 (85.05) | 78.0 (85.0) |
| track front / back, visual (physics) | 56.1 / 58.1 (51.8 / 59.0) | 53.1 / 59.3 (51.8 / 59.0) | 62.3 / 65.8 (62.2 / 66.0) | 63.3 / 63.3 (51.8 / 59.0) |
| overhang front / rear | 29.2 / 25.9 | 26.8 / 17.3 | 39.3 / 25.9 | 34.4 / 23.2 |
| bonnetLength (front − windscreenBase) | 49.3 | 32.5 | 62.7 | 24.7 |
| bonnetFrontH / bonnetMidH / cowlH | 33.8 / 36.0 / 37.4 | 25.8 / 29.7 / 35.2 | 24.1 / 30.8 / 31.6 | 42.2 / 44.4 / 47.3 |
| windscreenTopH / windscreenHalfWidth | 48.5 / 23.2 | 43.1 / 12.6 | 40.7 / 21.4 | 58.9 / 21.2 |
| roofFrontH / roofPeakX | 50.4 / −10.3 | 45.9 / 0.0 | 42.4 / −4.2 | 62.4 (brow) / 2.0 |
| glasshouseLength (roofFront − roofBack) | 59.0 | 33.2 | 42.4 | 95.7 |
| cabinHeight (roof − belt) | 16.2 | 18.6 | 11.3 | 19.9 |
| beltFrontH / beltRearH | 35.4 / 40.2 | 34.1 / 42.1 | 31.5 / 34.5 | 47.9 / 50.6 |
| sideGlassX / sideGlassTopH | −37.0..17.0 / 47.7 | 2.5..38.0 / 47.1 | −19.0..20.8 / 40.2 | 11.0..43.7 / 59.4 |
| side glass half width low / high | 27.4 / 25.1 | 16.4 / 14.2 | 22.1 / 17.6 | 25.0 / 22.3 |
| rearDeckH at x | 37.1 at −57.0 | 38.6 at −5.2 | 35.3 at −49.2 | 59.3 at −60.8 |
| tailTopH | 32.4 | 43.2 | 38.6 (ducktail) | 64.7 |
| waistHalfWidth at x | 32.4 at 29.5 | 20.9 at 27.0 | 31.6 at −4.9 | 30.9 at 15.5 |
| fender half width front / rear | 33.6 / 35.7 | 31.9 / 36.3 | 34.8 / 36.3 | 34.5 / 34.5 |
| above the roof, behind it | – | wing + intake: top 62.7, x −60.4..−2.3, half span 29.75 | – | lip 71.9 at −57.9 |

**Presets, hitboxes, T, wheels:** Octane → Standard (preset Octane), Dominus → Flat (MuscleCar), Merc → Tall (Merc); the
Fennec uses the Octane preset (Standard) (client `world.ts` CarBody 0/1/5 = engine `rlengine.cpp` BODIES[] 0/1/5). Hitbox UE
size / offset: Standard (120.5074, 86.6994, 38.6591) / (13.87566, 0, 20.754988); Flat (130.4268, 85.78, 33.8) / (9.0, 0, 15.75);
Tall (123.2202, 79.2103, 44.1591) / (11.37566, 0, 21.504988) (= engine CarConfig.cpp and the manifest). T = (0, 0, Tz): Fennec
2.6115 (non-legacy, SuspensionTravelMin 2), Octane 0.0198, Dominus 0.0097, Merc −0.9454 (legacy; no X offsets). Visual wheels
(R / W / o, three-axis body-GLB position, car-frame y):
- Fennec: front 12.75 / 13 / −0.5, (48.814, −6.112, ±28.061), y −3.50; back 13.75 / 13 / −0.5, (−36.515, −4.650, ±29.065), y −2.04.
- Octane: front 12.5 / 11.5 / 0.25, (51.281, −5.972, −26.706 left / +26.356 right: the mesh is asymmetric), y −5.952; back
  15 / 13 / 0.25, (−34.321, −4.320, ±29.645), y −4.30.
- Dominus: front 12 / 15 / 0, (50.371, −6.179, ±31.142), y −6.169; back 14 (WheelRadius 13.5) / 15 / 0, (−35.194, −6.110, ±32.897), y −6.10.
- Merc: front 15 / 14.5 / −1, (38.221, −6.559, ±31.659), y −7.505; back 16 / 15 / −1, (−39.828, −4.655, ±31.659), y −5.60. Its visual
  wheels sit 13.0 (front) and 6.1 (back) uu behind its physics wheels (the game's data; the constants use the visual ones,
  as FENNEC does).

**Body on hitbox** (nose past the hitbox front / tail past its back / sides inside / roof vs top / top incl. wing vs top /
clearance under the hitbox bottom / ground under the hitbox bottom, the last being what fennecFrame's y mapping needs):
Fennec 3.9 / 16.0 / 7.64 / 4.77 under / 4.06 under / 10.9 / 17.70; Octane 3.92 (tow hook 5.49) / 5.28 (wing 13.98) / 7.07 / 7.25
under / 3.46 over / 10.77 / 20.57; Dominus 15.47 / 4.88 (5.39 overall) / 6.63 / 9.21 under / 9.21 under / 14.87 / 18.24; Merc
−0.33 (light bar 4.49) / 12.76 (spare wheel 18.18) / 5.07 / 1.84 over / 6.03 over / 6.65 / 21.78.

**Spawn** (notes only): Z = 36.00 + Tz: Fennec 38.61, Octane 36.02, Dominus 36.01, Merc 35.05 (= engine SPAWN_Z for the last
three); no X offsets. By the user's decision (2026-10-16) the garage's Sport car (Fennec-like) spawns at the Octane's 36.02.

**Tyres vs body (CM1 follow-up):** the wheel z values are tyre centres (the OEM wheel mesh is symmetric about its origin,
±7.2644 before the W/15 scale; the chassis hubs end at the rim's centre face on all four cars). Tyre outer face vs the body
over each axle: Fennec +0.71 front / −0.35 back; Octane +0.05 (right) / +0.40 (left) front, −0.34 back; **Dominus +3.65 /
+3.91; Merc +4.14 / +4.39** (its widest parts there are the chassis flares; the painted body is 30.7 wide). So in the game's
data the Dominus's and Merc's tyres stand ≈ 4 uu proud of the body (bind pose; the native in-match wheel update wasn't
decompiled: if it applied the Merc's WheelOffsetSide inward, still 2.1 / 3.4 out).
