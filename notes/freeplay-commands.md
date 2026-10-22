# Free play's ball commands (FP3, built 2026-10-22)

The game's five free-play commands (FreeplayCommands_TA, the live 2026-10-06 build; the static session's spec and trail in
out/bsim/agents/FP3/), built as the game does them in `client/src/game/freeplayCommands.ts` (pure, the constants table
`FREEPLAY_COMMANDS`, the ball's bounds radius 103.22) and wired in `client/src/game/freeplay.ts`:

| Command (label, verbatim) | Default key / pad | What it does |
|---|---|---|
| Take Possession | 1 / D-pad down | the ball teleported ahead of the car: the hitbox's half-size length + 50 past the ball's bounds radius, that radius over the surface under the car (a ray down, the radius long) |
| Start Dribble | 2 / D-pad up | the ball teleported over the roof, moved back, lower and to the inside of a turn by the yaw rate (none on a wall), forward with the car's acceleration while slow |
| Pass Ball | 3 / D-pad left | the ball launched to a spot ahead of the car by its velocity over the flight (5 iterations), led 400 toward the goal it heads at most (a car at rest: the orange goal, the later of a tie), 100 high; speed ≤ 2778 |
| Launch Ball | 4 / D-pad right | the ball's upward speed held within 0..6000, then 750 more |
| Defend Shot | 5 / LB | the ball launched at 2778 sideways at a random spot across the nearest goal's mouth (x ±864.51, z 320 ± 280.51) |

- Either teleport in the air puts the ball over the car, 40 along its velocity and 25 forward. A teleport moves the ball
  with the car's velocity, keeps half its spin and keeps its rotation (`World.setBall` takes a rotation now); it's refused,
  the ball unchanged, inside a goal's volume or when the static world lies between the spot and the car.
- Each command needs a car that isn't demolished; no cooldown; they work while the ball moves; not in custom training.
- The defaults clash as the game's do (keys 1–4 and the D-pad with the quick chats, LB with the scoreboard): Freeplay and
  Match are exclusive binding groups now, so a saved profile with the scoreboard on LB keeps Defend Shot's LB.

**Deviations (ours):**
- The game traces a 1 uu box from the spot to the car; we cast a ray (`Sim.rayToStatic`, the engine's static collision
  alone), a hair thinner.
- Its teleport sounds (UI_Training_Teleport, and the refusal's) are our own: the menus' confirm and back cues (no sample of
  them here).
- The HUD's free-play controls list (the Controls Display setting) isn't built.
