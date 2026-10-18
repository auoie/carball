# Carball's car models

Each garage car can wear a model made in Blender: `sport.glb`, `flat.glb`, `tall.glb` here. A build bundles the ones
there are (`src/render/carGlb.ts`); a car without one, or with one that lacks a part, keeps its generated model
(`src/render/carModel.ts`). A model goes here only once the user has approved its renders: `sport.glb`, `flat.glb` and
`tall.glb` (the static session's CB1, 2026-10-18).

## What a model holds (glTF binary, Blender's export with +Y up)

- **Units and frame:** metres, 1 m = 100 uu. The front faces +X, up is +Z in Blender, left is +Y. The origin is the car's
  physics centre. At rest the physics holds it 17.0 uu over the ground (Sport; 16.84 Flat; 18.8 Tall, the engine's after
  5 s); the game draws Sport's tyres 16.3 below it, Flat's 19.4 and Tall's 22.4 (each body's bind pose: notes/hitboxes.md;
  model the wheels where the game draws them).
- **`Body`:** everything but the wheels (it may hold several meshes).
- **`Wheel_FL`, `Wheel_FR`, `Wheel_RL`, `Wheel_RR`:** one object a wheel (tyre and rim), its origin at the wheel's centre,
  its axle along Blender's Y. The game keeps each where the model has it along and across the car; it drops it within the
  body's drawn travel (its centre one physics radius above the physics' contact, or its hang in the air: SU1,
  notes/visual-timing.md VT-32) and takes its steering and its turning from the physics; its radius and width are the
  model's.
- **Exhausts:** an empty at each boost socket, every one named `Exhaust…`: `Exhaust_L` and `Exhaust_R` side by side (the
  Sport's apart, the Flat's close together), `Exhaust_Top` and `Exhaust_Bottom` stacked (the Tall's), or one `Exhaust`;
  four at most. Each points along its local −X (unrotated: straight back). The boost trail and the idle exhaust come out
  of each; with none, at the body's back as the generated cars'.
- **Materials:** `Paint` (recoloured to the team's colour: make it white or light grey), `Trim`, `Glass`, `Tire`, `Rim`,
  `Light_Head` and `Light_Tail` (drawn as the generated cars' lamps, clipped as the game's show: the file's emissive colour
  and strength aren't used). Others are kept as they are.
- **Budget:** at most 15,000 triangles, wheels included; no texture, or one at most; no animations, cameras or skins.
- **Names:** no car maker's, model's or game's name anywhere in the file (`src/render/carGlb.test.ts` checks, with the
  shipped-data guard: only these files ship).
