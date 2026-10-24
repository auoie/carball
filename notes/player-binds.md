# Player binds and camera settings (BIND1)

> **Licence:** this file adapts content from [Liquipedia's Rocket League wiki](https://liquipedia.net/rocketleague/) by
> Liquipedia contributors, licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); each player row
> links the exact page revision it was read from. Changes: the player pages' controls, camera and deadzone tables
> collected into these tables, spellings normalised (listed below), sorted, and summary statistics added. This file as a
> whole is licensed under CC BY-SA 3.0 (share-alike), separate from the rest of the repository.

Source: **Liquipedia** (Rocket League wiki), player pages' *Controls settings table*, *Camera settings table* and *Deadzone settings table* templates, read through the MediaWiki API (`action=query`, revision wikitext) on 2026-10-24. Liquipedia content is licensed **CC-BY-SA 3.0**; attribution: Liquipedia contributors, each row links the exact page revision it was read from. prosettings.net was not used: its legal notice requires prior written consent for any reproduction of its data.

- **Sample:** 230 player pages; 225 control tables: **123 keyboard and mouse**, **102 controller** (91 PlayStation, 11 Xbox; no Switch). 6 pages have a camera table only.
- **Who:** every player at the RLCS 2026 Boston and Paris Majors with a page (60), 49 well-known veterans and creators, and every page whose controls table says `controller=KBM` (121 more; Liquipedia lists few KBM players, so all of them). Pro or creator is Liquipedia's infobox `roles` (creator = Content Creator, Streamer or Freestyler): 15 creators.
- **Coverage of the source:** the controls template records only Throttle, Brake, Jump, Boost, Powerslide, Air roll, Air roll left/right and Ball cam (no steering, pitch/yaw, rear camera, mouse sensitivity). Steering keys are not on Liquipedia.
- **Dates:** *Settings date* is the template's own `date` (when the settings were last checked): the controls table's, else the deadzone table's, else the camera table's (controls tables rarely carry one); *Page rev* is the page revision's timestamp from the API. The tables sort by group, then (KBM) newest settings date first.
- **Normalised spellings** (values otherwise as listed): LBM/LEFT CLICK → LMB; RBM/RIGHT CLICK → RMB; ThumbMouse/MB4/MBB → Mouse 4; ThumbMouse2/MB5/MFB → Mouse 5; MB3/RollMousePress → Middle mouse; SMB → side mouse (unspecified); ⇧ Left Shift/Shift → Left Shift; CTRL/Left Control/Left ctrl → Left Ctrl; Spacebar/SPACE → Space; ↑ Arrow/UP → Up arrow; letters upper-cased; `—` = not bound. Key letters are the keycap the player names (an AZERTY player's Z is a QWERTY W's position).

## Summary statistics

### Most common bind per action

**Keyboard and mouse** (123 tables; counts exclude unbound slots)

| Action | Most common (count/bound) | Next |
|---|---|---|
| Throttle | **W** (108/123) | X 6, Up arrow 3 |
| Brake | **S** (118/123) | Down arrow 2, ] 1 |
| Jump | **RMB** (98/123) | Space 17, P 1 |
| Boost | **LMB** (109/123) | Left Shift 4, RMB 4 |
| Powerslide | **Left Shift** (110/123) | Left Ctrl 4, E 1 |
| Air roll | **Left Shift** (88/92) | Left Ctrl 1, Side mouse (unspecified) 1 |
| Air roll L | **Q** (78/105) | E 7, Mouse 4 7 |
| Air roll R | **E** (80/103) | Q 7, Mouse 5 6 |
| Ball cam | **Space** (102/123) | RMB 5, C 3 |

**PlayStation** (91 tables; counts exclude unbound slots)

| Action | Most common (count/bound) | Next |
|---|---|---|
| Throttle | **R2** (88/91) | R1 3 |
| Brake | **L2** (90/91) | L1 1 |
| Jump | **Cross** (89/91) | Circle 1, Square 1 |
| Boost | **Circle** (63/91) | R1 23, L1 3 |
| Powerslide | **Square** (48/91) | L1 34, R1 7 |
| Air roll | **L1** (42/83) | Square 25, R1 11 |
| Air roll L | **L1** (30/62) | Square 12, R1 7 |
| Air roll R | **R1** (37/62) | Circle 11, Square 8 |
| Ball cam | **Triangle** (89/91) | Square 2 |

**Xbox** (11 tables; counts exclude unbound slots)

| Action | Most common (count/bound) | Next |
|---|---|---|
| Throttle | **RT** (10/11) | Left stick 1 |
| Brake | **LT** (10/11) | Left stick 1 |
| Jump | **A** (9/11) | X 2 |
| Boost | **B** (8/11) | A 2, LB 1 |
| Powerslide | **X** (5/11) | LB 4, RB 1 |
| Air roll | **LB** (5/9) | X 3, LT 1 |
| Air roll L | **LB** (2/4) | X 1, RB 1 |
| Air roll R | **RB** (4/5) | LB 1 |
| Ball cam | **Y** (11/11) |  |

- KBM: powerslide and air roll on the same key in 85/123 tables; 109/123 bind directional air roll.
- Controller: powerslide and air roll on the same button in 67/102 tables; 87/102 bind directional air roll.

### Camera settings

All 230 camera tables in the sample (both devices).

| Setting | Distribution | Most common values (count) |
|---|---|---|
| FOV | n 230 · median 110 · IQR 110–110 · min 102 · max 110 | 110 (204), 109 (17), 108 (5), 102 (2), 105 (1), 107 (1) |
| Distance | n 230 · median 270 · IQR 270–270 · min 230 · max 400 | 270 (159), 260 (28), 280 (18), 250 (6), 290 (6), 240 (5) |
| Height | n 230 · median 100 · IQR 90–100 · min 80 · max 140 | 100 (120), 90 (60), 110 (42), 120 (5), 140 (1), 80 (1) |
| Angle | n 229 · median -4 · IQR -5–-3 · min -7 · max -2 | -3 (100), -4 (68), -5 (56), -2 (3), -7 (1), -6 (1) |
| Stiffness | n 230 · median 0.4 · IQR 0.35–0.5 · min 0.1 · max 1 | 0.35 (54), 0.4 (50), 0.45 (44), 0.5 (21), 0.6 (14), 0.55 (12) |
| Swivel speed | n 230 · median 5 · IQR 4–7 · min 1.5 · max 10 | 10 (26), 5 (25), 4 (18), 4.7 (15), 4.2 (15), 6 (14) |
| Transition speed | n 230 · median 1.4 · IQR 1.2–1.5 · min 0 · max 2 | 1.2 (37), 1 (34), 1.5 (32), 1.4 (30), 1.3 (29), 1.7 (17) |
| Ball camera | — | Toggle (228), Hold (2) |
| Camera shake | — | No (230) |

- KBM players only (123): FOV n 123 · median 110 · IQR 110–110 · min 102 · max 110; distance n 123 · median 270 · IQR 260–270 · min 230 · max 310; height n 123 · median 100 · IQR 100–110 · min 80 · max 130; angle n 123 · median -4 · IQR -5–-3 · min -7 · max -2.
- Controller players only (102): FOV n 102 · median 110 · IQR 110–110 · min 105 · max 110; distance n 102 · median 270 · IQR 270–270 · min 240 · max 400; height n 102 · median 100 · IQR 90–100 · min 90 · max 140; angle n 101 · median -4 · IQR -5–-3 · min -5 · max -2.

FOV, distance, height and angle (value: players):

- **FOV:** 102: 2, 105: 1, 107: 1, 108: 5, 109: 17, 110: 204
- **Distance:** 230: 2, 240: 5, 250: 6, 260: 28, 270: 159, 280: 18, 290: 6, 300: 3, 310: 2, 400: 1
- **Height:** 80: 1, 90: 60, 100: 120, 110: 42, 120: 5, 130: 1, 140: 1
- **Angle:** -7: 1, -6: 1, -5: 56, -4: 68, -3: 100, -2: 3

### Controller deadzone and sensitivity

102 deadzone tables: 97 on controller players' pages, 5 on pages with a KBM table or none.

| Setting | Distribution | Most common values (count) |
|---|---|---|
| Controller deadzone | n 102 · median 0.07 · IQR 0.05–0.07 · min 0.02 · max 0.75 | 0.05 (41), 0.07 (30), 0.1 (11), 0.08 (5), 0.06 (5), 0.09 (3) |
| Dodge deadzone | n 102 · median 0.7 · IQR 0.585–0.75 · min 0.1 · max 1 | 0.7 (20), 0.75 (13), 0.8 (13), 0.5 (13), 0.65 (10), 0.6 (7) |
| Aerial sensitivity | n 102 · median 1.525 · IQR 1.4–2 · min 1 · max 10 | 1.5 (16), 2 (15), 1.3 (13), 1.4 (8), 1.6 (7), 1.8 (4) |
| Steering sensitivity | n 102 · median 1.5 · IQR 1.4–2 · min 1 · max 10 | 1.5 (19), 1.3 (16), 2 (15), 1.4 (10), 1.6 (5), 2.9 (4) |
| Deadzone shape | — | Cross (87), Circle (8), Square (7) |

### Distinct inputs bound

Every input bound to at least one action, with the number of players binding it (any action).

| Device | Input | Players |
|---|---|---|
| KBM | Left Shift | 120 |
| KBM | S | 119 |
| KBM | Space | 119 |
| KBM | LMB | 113 |
| KBM | RMB | 110 |
| KBM | W | 109 |
| KBM | E | 87 |
| KBM | Q | 87 |
| KBM | Mouse 4 | 11 |
| KBM | Mouse 5 | 10 |
| KBM | X | 7 |
| KBM | A | 6 |
| KBM | C | 6 |
| KBM | Left Ctrl | 6 |
| KBM | D | 4 |
| KBM | Z | 4 |
| KBM | Up arrow | 3 |
| KBM | B | 2 |
| KBM | Down arrow | 2 |
| KBM | F | 2 |
| KBM | L | 2 |
| KBM | Middle mouse | 2 |
| KBM | P | 2 |
| KBM | R | 2 |
| KBM | / | 1 |
| KBM | End | 1 |
| KBM | Left Alt | 1 |
| KBM | M | 1 |
| KBM | MB1 (as listed) | 1 |
| KBM | MB2 (as listed) | 1 |
| KBM | Numpad * | 1 |
| KBM | Numpad 0 | 1 |
| KBM | O | 1 |
| KBM | Page Down | 1 |
| KBM | Right Shift | 1 |
| KBM | Side mouse (unspecified) | 1 |
| KBM | ] | 1 |
| KBM | ´ | 1 |
| KBM | ⇧ MB (as listed) | 1 |
| PlayStation | Cross | 91 |
| PlayStation | L2 | 91 |
| PlayStation | Triangle | 91 |
| PlayStation | R2 | 90 |
| PlayStation | L1 | 80 |
| PlayStation | R1 | 80 |
| PlayStation | Circle | 79 |
| PlayStation | Square | 70 |
| PlayStation | L3 | 1 |
| PlayStation | Paddle (as D-pad right) | 1 |
| PlayStation | R3 | 1 |
| Xbox | A | 11 |
| Xbox | LT | 11 |
| Xbox | Y | 11 |
| Xbox | RT | 10 |
| Xbox | B | 9 |
| Xbox | LB | 9 |
| Xbox | X | 8 |
| Xbox | RB | 6 |
| Xbox | Left stick | 1 |

## Keyboard and mouse

Camera columns: FOV, distance (Dist), height (Ht), angle, stiffness (Stiff), swivel speed (Swiv), transition speed (Trans), ball camera (Ball), camera shake (Shake). Group: M26 = RLCS 2026 Major player, V = veteran/creator list, K = KBM search.

| Player | Pro/creator | Group | Throttle | Brake | Jump | Boost | Powerslide | Air roll | Air roll L | Air roll R | Ball cam | FOV | Dist | Ht | Angle | Stiff | Swiv | Trans | Ball | Shake | Settings date | Page rev |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [Torsos](https://liquipedia.net/rocketleague/index.php?title=Torsos&oldid=2111874) | pro | M26 | W | S | Space | LMB | Left Shift | Left Shift | — | Mouse 4 | RMB | 110 | 250 | 100 | -3.0 | 0.60 | 10.00 | 1.40 | Toggle | No | 2026-07-15 | 2026-10-24 |
| [Yukeo](https://liquipedia.net/rocketleague/index.php?title=Yukeo&oldid=2109289) | pro | V | W | S | RMB | LMB | Left Shift | Left Shift | Mouse 4 | Mouse 5 | Space | 109 | 270 | 90 | -3.0 | 0.40 | 1.80 | 1.80 | Toggle | No | 2022-03-10 | 2026-10-16 |
| [Tinny (Hong Kong Player)](https://liquipedia.net/rocketleague/index.php?title=Tinny_(Hong_Kong_Player)&oldid=2021004) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 102 | 280 | 100 | -5.00 | 0.50 | 2.50 | 1.00 | Toggle | No | 2026-04-24 | 2026-04-26 |
| [ReUltras](https://liquipedia.net/rocketleague/index.php?title=ReUltras&oldid=2021011) | creator | K | W | S | RMB | LMB | Left Shift | Left Shift | — | E | Space | 110 | 260 | 110 | -4.0 | 0.50 | 2.40 | 1.40 | Toggle | No | 2026-04-04 | 2026-04-26 |
| [Sponsobobas](https://liquipedia.net/rocketleague/index.php?title=Sponsobobas&oldid=2104004) | pro | K | W | S | Space | LMB | ⇧ MB (as listed) | Left Shift | MB2 (as listed) | MB1 (as listed) | C | 110 | 270 | 90 | -4.0 | 0.45 | 6.00 | 1.70 | Toggle | No | 2026-03-11 | 2026-09-23 |
| [Sarak](https://liquipedia.net/rocketleague/index.php?title=Sarak&oldid=2003371) | pro | K | W | S | Space | RMB | Left Shift | Left Shift | Q | E | LMB | 110 | 270 | 100 | -5.0 | 0.40 | 10 | 1.70 | Toggle | No | 2026-03-03 | 2026-03-21 |
| [Evample](https://liquipedia.net/rocketleague/index.php?title=Evample&oldid=2001644) | pro | K | W | S | RMB | LMB | E | Left Shift | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.30 | 4.00 | 1.00 | Toggle | No | 2025-12-11 | 2026-03-18 |
| [Karvin](https://liquipedia.net/rocketleague/index.php?title=Karvin&oldid=2085037) | pro | K | W | S | RMB | LMB | Mouse 5 | — | Mouse 4 | Mouse 5 | Space | 110 | 270 | 90 | -4.0 | 0.40 | 4.20 | 1.20 | Toggle | No | 2025-12-05 | 2026-07-27 |
| [C4](https://liquipedia.net/rocketleague/index.php?title=C4&oldid=1941176) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 270 | 100 | -3.0 | 0.35 | 2.5 | 1.60 | Toggle | No | 2025-09-27 | 2025-11-23 |
| [Tr3bla](https://liquipedia.net/rocketleague/index.php?title=Tr3bla&oldid=2105701) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 260 | 100 | -3.0 | 0.35 | 5.60 | 1.70 | Toggle | No | 2025-07-05 | 2026-09-29 |
| [Zeddo](https://liquipedia.net/rocketleague/index.php?title=Zeddo&oldid=1940602) | pro | K | X | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -5.0 | 0.35 | 4.20 | 1.20 | Toggle | No | 2025-06-26 | 2025-11-22 |
| [KnS](https://liquipedia.net/rocketleague/index.php?title=KnS&oldid=2108722) | pro | K | ´ | ] | P | L | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.35 | 6.20 | 1.30 | Toggle | No | 2025-05-31 | 2026-10-12 |
| [Paraapelka](https://liquipedia.net/rocketleague/index.php?title=Paraapelka&oldid=2015726) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | C | 110 | 260 | 90 | -3.0 | 0.50 | 6.10 | 1.60 | Toggle | No | 2025-01-10 | 2026-04-14 |
| [Lucario](https://liquipedia.net/rocketleague/index.php?title=Lucario&oldid=2069620) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 260 | 90 | -4.00 | 0.45 | 6.40 | 1.40 | Toggle | No | 2024-12-18 | 2026-06-16 |
| [Pindroy](https://liquipedia.net/rocketleague/index.php?title=Pindroy&oldid=1949614) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | A | D | Space | 110 | 270 | 100 | -5.0 | 0.40 | 4.70 | 1.30 | Toggle | No | 2024-11-17 | 2025-12-02 |
| [Beyond](https://liquipedia.net/rocketleague/index.php?title=Beyond&oldid=2103699) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 110 | -3.00 | 0.35 | 3.90 | 1.80 | Toggle | No | 2024-10-27 | 2026-09-22 |
| [Herculyse](https://liquipedia.net/rocketleague/index.php?title=Herculyse&oldid=2106084) | creator | K | W | S | RMB | LMB | Left Shift | Left Shift | Mouse 4 | Mouse 5 | Space | 110 | 240 | 100 | -3.0 | 0.70 | 1.70 | 1.80 | Toggle | No | 2024-09-24 | 2026-10-01 |
| [Madhin](https://liquipedia.net/rocketleague/index.php?title=Madhin&oldid=2096658) | pro | K | W | S | RMB | LMB | Left Shift | — | E | Q | Space | 110 | 270 | 100 | -5.0 | 0.55 | 6.40 | 1.80 | Toggle | No | 2024-09-08 | 2026-08-20 |
| [TreZz](https://liquipedia.net/rocketleague/index.php?title=TreZz&oldid=2015030) | creator | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.35 | 4.70 | 1.50 | Toggle | No | 2024-08-17 | 2026-04-12 |
| [Greeen](https://liquipedia.net/rocketleague/index.php?title=Greeen&oldid=2069750) | pro | K | W | S | RMB | LMB | Left Shift | — | C | — | Space | 110 | 270 | 90 | -3.0 | 0.40 | 6.80 | 1.20 | Toggle | No | 2024-05-02 | 2026-06-17 |
| [C0mplex](https://liquipedia.net/rocketleague/index.php?title=C0mplex&oldid=2102866) | pro | K | W | S | RMB | LMB | Left Shift | — | E | Q | Space | 109 | 260 | 100 | -6.0 | 0.40 | 3.50 | 1.00 | Toggle | No | 2024-01-29 | 2026-09-19 |
| [Galaxy](https://liquipedia.net/rocketleague/index.php?title=Galaxy&oldid=2105638) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -4.0 | 0.40 | 5.00 | 1.70 | Toggle | No | 2023-12-12 | 2026-09-29 |
| [Zany](https://liquipedia.net/rocketleague/index.php?title=Zany&oldid=2103991) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -5.0 | 0.35 | 6.30 | 1.40 | Toggle | No | 2023-12-12 | 2026-09-23 |
| [Eraclesss](https://liquipedia.net/rocketleague/index.php?title=Eraclesss&oldid=2103895) | pro | K | Z | S | RMB | LMB | Left Shift | Left Shift | A | E | Space | 110 | 270 | 100 | -5.0 | 0.35 | 5.50 | 1.40 | Toggle | No | 2023-12-05 | 2026-09-23 |
| [Volterohh](https://liquipedia.net/rocketleague/index.php?title=Volterohh&oldid=1909431) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -3.0 | 0.45 | 7.00 | 1.50 | Toggle | No | 2023-10-21 | 2025-09-25 |
| [Tnt](https://liquipedia.net/rocketleague/index.php?title=Tnt&oldid=1916051) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -4.0 | 0.40 | 7.50 | 1.60 | Toggle | No | 2023-09-26 | 2025-10-07 |
| [FARz](https://liquipedia.net/rocketleague/index.php?title=FARz&oldid=2080742) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 300 | 110 | -4.0 | 0.75 | 9 | 1.7 | Toggle | No | 2023-09-04 | 2026-07-16 |
| [Faith](https://liquipedia.net/rocketleague/index.php?title=Faith&oldid=1909192) | creator | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 250 | 100 | -4.0 | 0.30 | 5.00 | 1.50 | Toggle | No | 2023-08-15 | 2025-09-25 |
| [Patroid](https://liquipedia.net/rocketleague/index.php?title=Patroid&oldid=1941465) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 270 | 100 | -5.0 | 0.50 | 4.20 | 1.00 | Toggle | No | 2023-06-15 | 2025-11-23 |
| [2Fast](https://liquipedia.net/rocketleague/index.php?title=2Fast&oldid=1939785) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 260 | 100 | -4.0 | 0.60 | 5.00 | 1.50 | Toggle | No | 2023-05-23 | 2025-11-22 |
| [Astro](https://liquipedia.net/rocketleague/index.php?title=Astro&oldid=1939858) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 109 | 260 | 110 | -3.0 | 0.60 | 3.80 | 1.00 | Toggle | No | 2023-04-25 | 2025-11-22 |
| [1zen](https://liquipedia.net/rocketleague/index.php?title=1zen&oldid=2085960) | pro | K | W | S | Space | LMB | Left Shift | Left Shift | Q | E | RMB | 110 | 280 | 110 | -3.0 | 0.30 | 8.00 | 1.20 | Toggle | No | 2023-04-03 | 2026-08-01 |
| [Dooz](https://liquipedia.net/rocketleague/index.php?title=Dooz&oldid=2072262) | pro | K | W | S | Space | LMB | Left Ctrl | — | Left Shift | Left Ctrl | B | 110 | 270 | 100 | -4.0 | 0.40 | 1.80 | 1.40 | Toggle | No | 2023-03-10 | 2026-06-24 |
| [Daffy](https://liquipedia.net/rocketleague/index.php?title=Daffy&oldid=1940702) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 270 | 90 | -5.0 | 0.45 | 5.60 | 1.00 | Toggle | No | 2023-01-23 | 2025-11-23 |
| [Thiagoritoo](https://liquipedia.net/rocketleague/index.php?title=Thiagoritoo&oldid=2013175) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 280 | 90 | -5.0 | 0.45 | 9.00 | 1.80 | Toggle | No | 2023-01-22 | 2026-04-09 |
| [Evil](https://liquipedia.net/rocketleague/index.php?title=Evil&oldid=2069847) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 240 | 90 | -3.0 | 0.40 | 7.00 | 1.20 | Toggle | No | 2023-01-21 | 2026-06-18 |
| [Slumpii](https://liquipedia.net/rocketleague/index.php?title=Slumpii&oldid=1941030) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 270 | 100 | -5.0 | 0.65 | 7.00 | 1.60 | Toggle | No | 2023-01-09 | 2025-11-23 |
| [EleXiT](https://liquipedia.net/rocketleague/index.php?title=EleXiT&oldid=2005702) | pro | K | Z | S | Space | RMB | W | C | — | X | A | 110 | 270 | 110 | -5.0 | 1.00 | 5.50 | 1.70 | Toggle | No | 2022-12-25 | 2026-03-25 |
| [Iration](https://liquipedia.net/rocketleague/index.php?title=Iration&oldid=1909485) | pro | K | W | S | Page Down | End | Left Shift | Left Shift | Q | E | Space | 102 | 290 | 130 | -2.0 | 0.20 | 6.00 | 1.10 | Toggle | No | 2022-12-21 | 2025-09-25 |
| [Pablobar](https://liquipedia.net/rocketleague/index.php?title=Pablobar&oldid=1940927) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -2.0 | 0.40 | 6.30 | 1.50 | Toggle | No | 2022-11-13 | 2025-11-23 |
| [Jayy 08](https://liquipedia.net/rocketleague/index.php?title=Jayy_08&oldid=1941329) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 270 | 90 | -5.0 | 0.65 | 3.00 | 1.00 | Toggle | No | 2022-11-07 | 2025-11-23 |
| [Jey](https://liquipedia.net/rocketleague/index.php?title=Jey&oldid=2012486) | pro | K | Z | S | Space | RMB | Left Shift | Left Shift | Mouse 5 | Mouse 4 | LMB | 110 | 260 | 110 | -5.0 | 0.70 | 5.00 | 1.40 | Toggle | No | 2022-11-04 | 2026-04-08 |
| [Blade](https://liquipedia.net/rocketleague/index.php?title=Blade&oldid=2103923) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.35 | 4.00 | 1.00 | Toggle | No | 2022-10-30 | 2026-09-23 |
| [MrGrony](https://liquipedia.net/rocketleague/index.php?title=MrGrony&oldid=1909350) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 109 | 270 | 100 | -5.0 | 0.45 | 4.20 | 1.20 | Toggle | No | 2022-10-29 | 2025-09-25 |
| [Vis](https://liquipedia.net/rocketleague/index.php?title=Vis&oldid=1941095) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.40 | 5.60 | 1.20 | Toggle | No | 2022-09-17 | 2025-11-23 |
| [PotatoWithaGun](https://liquipedia.net/rocketleague/index.php?title=PotatoWithaGun&oldid=2103966) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 270 | 100. | -4.0 | 0.50 | 6.00 | 1.00 | Toggle | No | 2022-05-30 | 2026-09-23 |
| [Revise](https://liquipedia.net/rocketleague/index.php?title=Revise&oldid=1942078) | pro | K | W | S | Space | LMB | Left Shift | Left Shift | E | Q | C | 110 | 270 | 100 | -5.0 | 0.40 | 8.50 | 1.80 | Toggle | No | 2022-05-28 | 2025-11-23 |
| [Arceon](https://liquipedia.net/rocketleague/index.php?title=Arceon&oldid=2103994) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 260 | 100 | -5.0 | 0.45 | 5.40 | 1.20 | Toggle | No | 2022-04-27 | 2026-09-23 |
| [Hartmann](https://liquipedia.net/rocketleague/index.php?title=Hartmann&oldid=1940797) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 110 | -3.0 | 0.40 | 4.20 | 1.70 | Toggle | No | 2022-04-24 | 2025-11-23 |
| [Patty](https://liquipedia.net/rocketleague/index.php?title=Patty&oldid=2110972) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 110 | -3.0 | 0.55 | 5.60 | 1.60 | Toggle | No | 2022-04-19 | 2026-10-21 |
| [J1](https://liquipedia.net/rocketleague/index.php?title=J1&oldid=1908789) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 290 | 100 | -5.0 | 0.30 | 4.20 | 1.70 | Toggle | No | 2022-03-20 | 2025-09-25 |
| [Res](https://liquipedia.net/rocketleague/index.php?title=Res&oldid=1941504) | pro | K | W | S | Space | LMB | Left Shift | Left Shift | Q | E | RMB | 110 | 270 | 100 | -4.0 | 0.40 | 2.10 | 1.30 | Toggle | No | 2022-03-20 | 2025-11-23 |
| [Will](https://liquipedia.net/rocketleague/index.php?title=Will&oldid=1942201) | pro | K | W | S | Space | LMB | Left Shift | — | RMB | — | Q | 110 | 270 | 110 | -3.0 | 0.55 | 6.10 | 1.20 | Toggle | No | 2022-02-26 | 2025-11-23 |
| [Canom](https://liquipedia.net/rocketleague/index.php?title=Canom&oldid=1908631) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 280 | 110 | -3.0 | 0.45 | 7.50 | 2.00 | Toggle | No | 2022-01-30 | 2025-09-25 |
| [Akwack](https://liquipedia.net/rocketleague/index.php?title=Akwack&oldid=1908586) | pro | K | W | S | RMB | LMB | Middle mouse | Left Shift | Q | E | Space | 110 | 290 | 120 | -4.0 | 0.50 | 2.80 | 1.00 | Toggle | No | 2022-01-19 | 2025-09-25 |
| [SKR](https://liquipedia.net/rocketleague/index.php?title=SKR&oldid=1908590) | pro | K | Up arrow | S | Numpad 0 | Left Alt | Right Shift | Left Shift | Q | E | Space | 110 | 260 | 110 | -5.0 | 0.35 | 2.50 | 1.00 | Toggle | No | 2022-01-19 | 2025-09-25 |
| [Alex837](https://liquipedia.net/rocketleague/index.php?title=Alex837&oldid=1989887) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 110 | -4.0 | 0.40 | 4.70 | 1.80 | Toggle | No | 2022-01-18 | 2026-02-08 |
| [Atla](https://liquipedia.net/rocketleague/index.php?title=Atla&oldid=1892975) | pro | K | W | S | Numpad * | / | Left Ctrl | Left Shift | Left Ctrl | E | Space | 110 | 270 | 100 | -3.0 | 0.30 | 10.00 | 2.00 | Toggle | No | 2022-01-16 | 2025-08-24 |
| [Diesalot](https://liquipedia.net/rocketleague/index.php?title=Diesalot&oldid=1908570) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 280 | 110 | -4.0 | 0.75 | 4.80 | 1.60 | Toggle | No | 2022-01-16 | 2025-09-25 |
| [Semiroundrat](https://liquipedia.net/rocketleague/index.php?title=Semiroundrat&oldid=1941529) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 240 | 110 | -3.0 | 0.50 | 5.30 | 1.40 | Toggle | No | 2022-01-16 | 2025-11-23 |
| [Kabbo](https://liquipedia.net/rocketleague/index.php?title=Kabbo&oldid=1908565) | pro | K | W | S | RMB | LMB | Left Shift | — | — | E | Space | 110 | 280 | 100 | -4.0 | 0.50 | 4.20 | 1.70 | Toggle | No | 2022-01-15 | 2025-09-25 |
| [RenaN](https://liquipedia.net/rocketleague/index.php?title=RenaN&oldid=2099455) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Mouse 4 | Mouse 5 | Space | 109 | 270 | 100 | -3.0 | 0.40 | 4.80 | 1.80 | Toggle | No | 2021-12-30 | 2026-09-02 |
| [MachtFISCH](https://liquipedia.net/rocketleague/index.php?title=MachtFISCH&oldid=2099910) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | A | D | Space | 110 | 310 | 100 | -7.0 | 0.80 | 5.00 | 1.60 | Toggle | No | 2021-11-07 | 2026-09-04 |
| [Fearlesscarrot](https://liquipedia.net/rocketleague/index.php?title=Fearlesscarrot&oldid=2103996) | pro | K | W | S | Space | LMB | Left Shift | — | Q | E | RMB | 110 | 270 | 110 | -3.0 | 0.80 | 6.00 | 1.30 | Toggle | No | 2021-11-02 | 2026-09-23 |
| [Claw-Z](https://liquipedia.net/rocketleague/index.php?title=Claw-Z&oldid=2096682) | pro | K | W | S | Space | LMB | Left Shift | — | Q | E | RMB | 110 | 260 | 100 | -4.0 | 0.60 | 5.30 | 1.50 | Toggle | No | 2021-10-26 | 2026-08-20 |
| [CokeHUN](https://liquipedia.net/rocketleague/index.php?title=CokeHUN&oldid=1939963) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 260 | 100 | -4.0 | 0.70 | 5.00 | 1.80 | Toggle | No | 2021-10-17 | 2025-11-22 |
| [GWR](https://liquipedia.net/rocketleague/index.php?title=GWR&oldid=2002819) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -5.0 | 0.50 | 10.00 | 1.00 | Toggle | No | 2021-10-12 | 2026-03-20 |
| [Psycho (Turkish Player)](https://liquipedia.net/rocketleague/index.php?title=Psycho_(Turkish_Player)&oldid=1927750) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -5.0 | 0.40 | 4.70 | 1.30 | Toggle | No | 2021-08-28 | 2025-10-31 |
| [Blaze (North American Player)](https://liquipedia.net/rocketleague/index.php?title=Blaze_(North_American_Player)&oldid=1907527) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Mouse 4 | Mouse 5 | Space | 108 | 270 | 90 | -3.0 | 0.10 | 10.00 | 1.80 | Toggle | No | 2021-08-06 | 2025-09-24 |
| [Lia](https://liquipedia.net/rocketleague/index.php?title=Lia&oldid=1936743) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 270 | 110 | -4.0 | 0.45 | 6.00 | 1.50 | Toggle | No | 2021-07-28 | 2025-11-17 |
| [Ryu](https://liquipedia.net/rocketleague/index.php?title=Ryu&oldid=1861961) | pro | K | W | S | LMB | RMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -4.0 | 0.35 | 5.00 | 1.50 | Toggle | No | 2021-07-13 | 2025-06-16 |
| [Coach Curtis](https://liquipedia.net/rocketleague/index.php?title=Coach_Curtis&oldid=1906649) | pro | K | Up arrow | Down arrow | Space | Left Shift | F | — | Q | E | R | 110 | 270 | 100 | -5.0 | 0.40 | 4.70 | 1.30 | Toggle | No | 2021-07-05 | 2025-09-24 |
| [Dark](https://liquipedia.net/rocketleague/index.php?title=Dark&oldid=1906777) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 290 | 110 | -3.0 | 0.40 | 5.00 | 1.30 | Toggle | No | 2021-07-01 | 2025-09-24 |
| [Surreal](https://liquipedia.net/rocketleague/index.php?title=Surreal&oldid=1907825) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 109 | 270 | 90 | -4.0 | 0.45 | 10.00 | 1.20 | Toggle | No | 2021-07-01 | 2025-09-24 |
| [Azara](https://liquipedia.net/rocketleague/index.php?title=Azara&oldid=1909032) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Mouse 4 | — | Space | 110 | 260 | 100 | -3.0 | 0.40 | 6.60 | 1.40 | Toggle | No | 2021-06-09 | 2025-09-25 |
| [Kfactor](https://liquipedia.net/rocketleague/index.php?title=Kfactor&oldid=1861759) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 110 | -3.0 | 0.35 | 4.20 | 1.00 | Toggle | No | 2021-06-04 | 2025-06-16 |
| [Stake](https://liquipedia.net/rocketleague/index.php?title=Stake&oldid=2106333) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -3.0 | 0.55 | 4.30 | 1.40 | Toggle | No | 2021-03-29 | 2026-10-02 |
| [Ignited](https://liquipedia.net/rocketleague/index.php?title=Ignited&oldid=1996697) | pro | K | W | S | Mouse 5 | Mouse 4 | Left Shift | — | E | Q | Space | 110 | 280 | 90 | -4.0 | 1.00 | 3.00 | 1.10 | Toggle | No | 2021-03-28 | 2026-03-03 |
| [Minkey](https://liquipedia.net/rocketleague/index.php?title=Minkey&oldid=1908837) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 109 | 260 | 110 | -3.0 | 0.60 | 4.00 | 1.20 | Toggle | No | 2021-03-26 | 2025-09-25 |
| [Skynti](https://liquipedia.net/rocketleague/index.php?title=Skynti&oldid=1941547) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -4.0 | 0.35 | 4.00 | 2.00 | Toggle | No | 2021-03-24 | 2025-11-23 |
| [Lakitue](https://liquipedia.net/rocketleague/index.php?title=Lakitue&oldid=2107661) | pro | K | W | Middle mouse | Space | Left Shift | Left Ctrl | — | A | D | Q | 110 | 270 | 120 | -4.0 | 0.40 | 4.70 | 1.50 | Toggle | No | 2021-03-08 | 2026-10-06 |
| [Zamberg](https://liquipedia.net/rocketleague/index.php?title=Zamberg&oldid=1967517) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | — | Space | 108 | 260 | 110 | -3.0 | 0.50 | 4.20 | 1.00 | Toggle | No | 2021-02-16 | 2026-01-13 |
| [CrowsShinyWings](https://liquipedia.net/rocketleague/index.php?title=CrowsShinyWings&oldid=1940689) | pro | K | W | S | Space | LMB | Left Shift | — | Q | RMB | R | 110 | 260 | 100 | -4.0 | 0.60 | 5.00 | 1.50 | Toggle | No | 2021-01-26 | 2025-11-23 |
| [Zayd](https://liquipedia.net/rocketleague/index.php?title=Zayd&oldid=1940601) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 230 | 100 | -3.0 | 0.70 | 3.00 | 1.00 | Toggle | No | 2021-01-04 | 2025-11-22 |
| [Jupiter](https://liquipedia.net/rocketleague/index.php?title=Jupiter&oldid=1906592) | pro | K | RMB | S | Mouse 4 | LMB | Left Shift | — | Q | E | Mouse 5 | 110 | 270 | 110 | -4.0 | 0.55 | 7.5 | 1.50 | Toggle | No | 2021-01-01 | 2025-09-24 |
| [Shin (Argentinian Player)](https://liquipedia.net/rocketleague/index.php?title=Shin_(Argentinian_Player)&oldid=1970219) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.30 | 6.50 | 1.90 | Toggle | No | 2020-17-08 | 2026-01-19 |
| [Danii](https://liquipedia.net/rocketleague/index.php?title=Danii&oldid=1941202) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 280 | 100 | -4.0 | 0.50 | 4.00 | 1.30 | Toggle | No | 2020-12-21 | 2025-11-23 |
| [Storm (American Player)](https://liquipedia.net/rocketleague/index.php?title=Storm_(American_Player)&oldid=1894239) | pro | K | O | L | D | S | A | A | M | P | F | 110 | 270 | 110 | -3.0 | 0.45 | 10.00 | 1.70 | Toggle | No | 2020-12-15 | 2025-08-25 |
| [Astra](https://liquipedia.net/rocketleague/index.php?title=Astra&oldid=1906634) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 300 | 120 | -4.0 | 0.60 | 2.40 | 1.70 | Toggle | No | 2020-11-11 | 2025-09-24 |
| [Suto](https://liquipedia.net/rocketleague/index.php?title=Suto&oldid=1862563) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -4.0 | 0.40 | 3.00 | 1.00 | Toggle | No | 2020-11-11 | 2025-06-17 |
| [Zenulous](https://liquipedia.net/rocketleague/index.php?title=Zenulous&oldid=2020751) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | E | Q | Space | 110 | 270 | 90 | -4.0 | 0.40 | 5.00 | 1.00 | Toggle | No | 2020-11-01 | 2026-04-25 |
| [Falacer](https://liquipedia.net/rocketleague/index.php?title=Falacer&oldid=2103939) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 240 | 100 | -4.0 | 0.45 | 10.00 | 1.50 | Toggle | No | 2020-10-25 | 2026-09-23 |
| [Venso63](https://liquipedia.net/rocketleague/index.php?title=Venso63&oldid=1907540) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | C | — | Space | 110 | 270 | 100 | -3.0 | 0.45 | 3.00 | 1.70 | Toggle | No | 2020-10-25 | 2025-09-24 |
| [Hp](https://liquipedia.net/rocketleague/index.php?title=Hp&oldid=1961300) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 280 | 120 | -3.0 | 0.40 | 6.50 | 1.20 | Toggle | No | 2020-10-18 | 2025-12-26 |
| [Painyyy](https://liquipedia.net/rocketleague/index.php?title=Painyyy&oldid=1940928) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 110 | -4.0 | 0.30 | 2.50 | 1.40 | Toggle | No | 2020-10-18 | 2025-11-23 |
| [Rivalo Nero](https://liquipedia.net/rocketleague/index.php?title=Rivalo_Nero&oldid=1940976) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 270 | 100 | -4.0 | 0.70 | 4.00 | 1.40 | Toggle | No | 2020-09-30 | 2025-11-23 |
| [FishhR](https://liquipedia.net/rocketleague/index.php?title=FishhR&oldid=2069341) | pro | K | W | S | RMB | LMB | Left Shift | Side mouse (unspecified) | Q | E | Space | 110 | 250 | 90 | -3.0 | 0.70 | 7.10 | 1.10 | Toggle | No | 2020-08-13 | 2026-06-15 |
| [Ic3fl4me](https://liquipedia.net/rocketleague/index.php?title=Ic3fl4me&oldid=1940806) | pro | K | X | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 260 | 100 | -3.0 | 0.80 | 7.50 | 1.50 | Toggle | No | 2020-08-04 | 2025-11-23 |
| [Zee9](https://liquipedia.net/rocketleague/index.php?title=Zee9&oldid=1906013) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Left Ctrl | — | Space | 110 | 290 | 90 | -4.0 | 0.25 | 10.00 | 1.20 | Toggle | No | 2020-07-30 | 2025-09-24 |
| [Trey](https://liquipedia.net/rocketleague/index.php?title=Trey&oldid=1940556) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 270 | 100 | -5.0 | 0.45 | 2.40 | 1.00 | Toggle | No | 2020-07-07 | 2025-11-22 |
| [Smoog](https://liquipedia.net/rocketleague/index.php?title=Smoog&oldid=1906942) | pro | K | W | S | Space | Left Shift | LMB | — | Q | E | Mouse 5 | 110 | 280 | 80 | -3.0 | 0.30 | 4.70 | 0.40 | Toggle | No | 2020-07-01 | 2025-09-24 |
| [CJM](https://liquipedia.net/rocketleague/index.php?title=CJM&oldid=1905967) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 230 | 90 | -4.0 | 0.70 | 4.00 | 1.20 | Toggle | No | 2020-06-25 | 2025-09-23 |
| [Cobbo](https://liquipedia.net/rocketleague/index.php?title=Cobbo&oldid=2001739) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 250 | 110 | -3.0 | 0.50 | 2.50 | 1.10 | Toggle | No | 2020-06-01 | 2026-03-18 |
| [Yumi cheeseman](https://liquipedia.net/rocketleague/index.php?title=Yumi_cheeseman&oldid=1905913) | pro | K | Up arrow | Down arrow | Space | Left Shift | Left Ctrl | Left Ctrl | — | — | Z | 110 | 270 | 100 | -4.0 | 0.55 | 5.00 | 1.70 | Toggle | No | 2020-05-31 | 2025-09-23 |
| [Cavemanben](https://liquipedia.net/rocketleague/index.php?title=Cavemanben&oldid=2091946) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 109 | 270 | 100 | -5.0 | 0.45 | 4.30 | 1.30 | Toggle | No | 2020-05-16 | 2026-08-16 |
| [TaTu](https://liquipedia.net/rocketleague/index.php?title=TaTu&oldid=1906758) | pro | K | X | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -5.0 | 0.45 | 6.50 | 1.60 | Toggle | No | 2020-05-03 | 2025-09-24 |
| [Eckhard](https://liquipedia.net/rocketleague/index.php?title=Eckhard&oldid=1940730) | pro | K | X | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -5.0 | 0.45 | 4.20 | 1.20 | Toggle | No | 2020-04-21 | 2025-11-23 |
| [Fabso](https://liquipedia.net/rocketleague/index.php?title=Fabso&oldid=1940079) | pro | K | X | S | RMB | LMB | Left Shift | Left Shift | Mouse 4 | Mouse 5 | Space | 110 | 280 | 100 | -3.0 | 0.35 | 2.50 | 1.10 | Toggle | No | 2020-04-21 | 2025-11-22 |
| [Poofy](https://liquipedia.net/rocketleague/index.php?title=Poofy&oldid=1940949) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 280 | 100 | -4.0 | 0.45 | 4.40 | 1.50 | Toggle | No | 2020-04-16 | 2025-11-23 |
| [Cyrexal](https://liquipedia.net/rocketleague/index.php?title=Cyrexal&oldid=1906683) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 260 | 110 | -5.0 | 0.55 | 10.00 | 0 | Toggle | No | 2020-03-25 | 2025-09-24 |
| [KyRo](https://liquipedia.net/rocketleague/index.php?title=KyRo&oldid=1906682) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 280 | 110 | -5.0 | 0.50 | 5.00 | 1.30 | Toggle | No | 2020-03-25 | 2025-09-24 |
| [DNa](https://liquipedia.net/rocketleague/index.php?title=DNa&oldid=1906639) | pro | K | X | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -5.0 | 0.40 | 3.00 | 1.50 | Toggle | No | 2020-02-26 | 2025-09-24 |
| [TheMagnet39](https://liquipedia.net/rocketleague/index.php?title=TheMagnet39&oldid=1906642) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | E | Q | B | 110 | 250 | 90 | -3.0 | 0.65 | 3.50 | 1.20 | Toggle | No | 2020-02-23 | 2025-09-24 |
| [Fruity](https://liquipedia.net/rocketleague/index.php?title=Fruity&oldid=2084977) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 270 | 110 | -3.0 | 0.60 | 4.20 | 1.40 | Toggle | No | 2020-02-18 | 2026-07-27 |
| [Mikey12](https://liquipedia.net/rocketleague/index.php?title=Mikey12&oldid=1906521) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | E | Q | Space | 110 | 290 | 120 | -3.0 | 0.40 | 6.00 | 1.00 | Toggle | No | 2019-12-08 | 2025-09-24 |
| [LCT](https://liquipedia.net/rocketleague/index.php?title=LCT&oldid=2096689) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.45 | 6.70 | 1.20 | Toggle | No | 2019-10-09 | 2026-08-20 |
| [Inferno](https://liquipedia.net/rocketleague/index.php?title=Inferno&oldid=1940169) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 90 | -4.0 | 0.50 | 5.00 | 1.00 | Toggle | No | 2019-09-18 | 2025-11-22 |
| [Coop0](https://liquipedia.net/rocketleague/index.php?title=Coop0&oldid=1906377) | pro | K | W | S | RMB | LMB | Left Shift | — | Q | E | Space | 110 | 280 | 110 | -3.0 | 0.55 | 7.00 | 1.30 | Toggle | No | 2019-07-06 | 2025-09-24 |
| [Lerky](https://liquipedia.net/rocketleague/index.php?title=Lerky&oldid=1906272) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 270 | 90 | -4.0 | 0.60 | 5.00 | 1.20 | Toggle | No | 2019-06-23 | 2025-09-24 |
| [Blu3y](https://liquipedia.net/rocketleague/index.php?title=Blu3y&oldid=2020729) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | — | — | Space | 110 | 250 | 110 | -4.0 | 0.40 | 7.00 | 1.20 | Toggle | No | 2019-06-07 | 2026-04-25 |
| [FenoSiicK](https://liquipedia.net/rocketleague/index.php?title=FenoSiicK&oldid=1941815) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 260 | 110 | -3.0 | 0.40 | 5.50 | 1.00 | Toggle | No | 2019-03-30 | 2025-11-23 |
| [Facha510](https://liquipedia.net/rocketleague/index.php?title=Facha510&oldid=1860618) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 110 | -3.0 | 0.50 | 3.00 | 1.40 | Toggle | No | 2019-03-24 | 2025-06-16 |
| [Impressive](https://liquipedia.net/rocketleague/index.php?title=Impressive&oldid=1940812) | pro | K | W | S | RMB | LMB | Left Shift | Left Shift | Q | E | Space | 110 | 270 | 100 | -3.0 | 0.45 | 7.00 | 1.50 | Toggle | No | 2019-02-25 | 2025-11-23 |

## Controller

Deadzone columns: shape, controller deadzone (DZ), dodge deadzone (Dodge), aerial sensitivity (Aer), steering sensitivity (Steer), where the page has a deadzone table.

| Player | Pro/creator | Group | Pad | Jump | Boost | Powerslide | Air roll | Air roll L | Air roll R | Ball cam | Brake | Throttle | Shape | DZ | Dodge | Aer | Steer | FOV | Dist | Ht | Angle | Stiff | Swiv | Trans | Ball | Shake | Settings date | Page rev |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [Accro](https://liquipedia.net/rocketleague/index.php?title=Accro&oldid=2106090) | pro | M26 | PS | Cross | Circle | Square | Square | — | L1 | Triangle | L2 | R2 | Cross | 0.05 | 0.67 | 2.00 | 2.00 | 109 | 270 | 90 | -4.0 | 0.45 | 10.00 | 1.70 | Toggle | No | 2021-12-21 | 2026-10-01 |
| [ApparentlyJack](https://liquipedia.net/rocketleague/index.php?title=ApparentlyJack&oldid=2106517) | pro | M26 | PS | Cross | R1 | L1 | L1 | Square | Circle | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.64 | 1.40 | 110 | 270 | 100 | -3.0 | 0.35 | 2.20 | 1.80 | Toggle | No | 2024-09-29 | 2026-10-03 |
| [Archie](https://liquipedia.net/rocketleague/index.php?title=Archie&oldid=2107394) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.75 | 1.73 | 1.73 | 109 | 270 | 90 | -4.0 | 0.60 | 2.00 | 1.20 | Toggle | No | 2020-04-14 | 2026-10-04 |
| [Atomic](https://liquipedia.net/rocketleague/index.php?title=Atomic&oldid=2109560) | pro | M26 | PS | Cross | Circle | Square | R1 | L1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.40 | 2.00 | 2.00 | 110 | 270 | 100 | -3.0 | 0.35 | 6.90 | 1.20 | Toggle | No | 2024-06-16 | 2026-10-17 |
| [Atow](https://liquipedia.net/rocketleague/index.php?title=Atow&oldid=2111818) | pro | M26 | PS | Cross | Circle | L1 | L1 | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.50 | 2.00 | 2.00 | 110 | 270 | 100 | -3.0 | 0.40 | 4.20 | 1.40 | Toggle | No | 2026-05-26 | 2026-10-23 |
| [Bananahead](https://liquipedia.net/rocketleague/index.php?title=Bananahead&oldid=2105777) | pro | M26 | PS | Cross | Circle | R1 | R1 | L1 | — | Triangle | L2 | R2 | Cross | 0.10 | 0.70 | 2.01 | 2.89 | 109 | 270 | 90 | -4.0 | 0.45 | 6.70 | 1.40 | Toggle | No | 2022-04-28 | 2026-09-29 |
| [BeastMode](https://liquipedia.net/rocketleague/index.php?title=BeastMode&oldid=2109558) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.30 | 1.30 | 109 | 270 | 90 | -4.0 | 0.45 | 7.00 | 1.20 | Toggle | No | 2022-07-17 | 2026-10-17 |
| [Catalysm](https://liquipedia.net/rocketleague/index.php?title=Catalysm&oldid=2105759) | pro | M26 | PS | Cross | Circle | L1 | L1 | Square | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.80 | 1.80 | 110 | 270 | 100 | -5.0 | 0.40 | 7.30 | 1.40 | Toggle | No | 2020-10-13 | 2026-09-29 |
| [CHEESE](https://liquipedia.net/rocketleague/index.php?title=CHEESE&oldid=2107782) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.65 | 1.50 | 1.50 | 110 | 270 | 90 | -5.0 | 0.35 | 9.00 | 1.70 | Toggle | No | 2026-10-03 | 2026-10-06 |
| [Chronic](https://liquipedia.net/rocketleague/index.php?title=Chronic&oldid=2106865) | pro | M26 | PS | Cross | Circle | Square | L1 | — | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 270 | 90 | -4.0 | 0.35 | 5.00 | 1.30 | Toggle | No | 2025-12-11 | 2026-10-03 |
| [Crr](https://liquipedia.net/rocketleague/index.php?title=Crr&oldid=2105875) | pro | M26 | PS | Cross | Circle | Square | L2 | L1 | R1 | Triangle | L2 | R2 | Cross | 0.09 | 0.75 | 3.00 | 2.90 | 110 | 270 | 90 | -5.0 | 0.35 | 6.10 | 1.50 | Toggle | No | 2025-12-06 | 2026-09-30 |
| [Daniel](https://liquipedia.net/rocketleague/index.php?title=Daniel&oldid=2109556) | pro | M26 | PS | Cross | Circle | R1 | R1 | L1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.30 | 1.30 | 110 | 270 | 100 | -3.0 | 0.35 | 4.70 | 1.20 | Toggle | No | 2025-11-25 | 2026-10-17 |
| [Darth](https://liquipedia.net/rocketleague/index.php?title=Darth&oldid=2103946) | pro | M26 | PS | Cross | R1 | L1 | Square | L1 | Circle | Triangle | L2 | R2 | Cross | 0.04 | 0.70 | 1.80 | 1.85 | 108 | 270 | 100 | -3.0 | 0.35 | 10.00 | 1.70 | Toggle | No | 2021-11-29 | 2026-09-23 |
| [Diaz (Brazilian Player)](https://liquipedia.net/rocketleague/index.php?title=Diaz_(Brazilian_Player)&oldid=2110882) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.80 | 1.30 | 1.30 | 110 | 270 | 100 | -3.0 | 0.35 | 4.70 | 1.20 | Toggle | No | 2026-09-17 | 2026-10-21 |
| [Dralii](https://liquipedia.net/rocketleague/index.php?title=Dralii&oldid=2105610) | pro | M26 | PS | Cross | Circle | R1 | — | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.77 | 1.77 | 1.77 | 110 | 270 | 90 | -5.0 | 0.50 | 4.20 | 1.50 | Toggle | No | 2025-12-21 | 2026-09-29 |
| [Ejby](https://liquipedia.net/rocketleague/index.php?title=Ejby&oldid=2106089) | pro | M26 | PS | Cross | Circle | Square | L1 | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.67 | 1.50 | 1.50 | 110 | 270 | 100 | -3.0 | 0.35 | 5.50 | 1.50 | Toggle | No | 2026-02-10 | 2026-10-01 |
| [ExoTiiK](https://liquipedia.net/rocketleague/index.php?title=ExoTiiK&oldid=2110496) | pro | M26 | PS | Cross | R1 | Square | L1 | Circle | — | Triangle | L2 | R2 | Circle | 0.07 | 0.80 | 1.60 | 1.70 | 110 | 270 | 100 | -3.0 | 0.35 | 4.00 | 1.00 | Toggle | No | 2026-09-17 | 2026-10-20 |
| [Fever](https://liquipedia.net/rocketleague/index.php?title=Fever&oldid=2111873) | pro | M26 | Xbox | A | B | X | X | LB | RB | Y | LT | RT | Cross | 0.05 | 0.60 | 2.00 | 2.00 | 110 | 270 | 100 | -5.0 | 0.40 | 8.10 | 1.30 | Toggle | No | 2023-01-13 | 2026-10-24 |
| [Fiberr](https://liquipedia.net/rocketleague/index.php?title=Fiberr&oldid=2002204) | pro | M26 | PS | Cross | Circle | L1 | L1 | R1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 2.90 | 2.90 | 110 | 270 | 100 | -3.0 | 0.45 | 10.00 | 1.50 | Toggle | No | 2020-02-23 | 2026-03-19 |
| [Firstkiller](https://liquipedia.net/rocketleague/index.php?title=Firstkiller&oldid=2106076) | pro | M26 | PS | Cross | Circle | Square | Square | R1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.60 | 1.30 | 1.30 | 110 | 270 | 100 | -3.0 | 0.35 | 6.90 | 1.00 | Toggle | No | 2025-12-11 | 2026-10-01 |
| [Ghaazi](https://liquipedia.net/rocketleague/index.php?title=Ghaazi&oldid=2105757) | pro | M26 | PS | Cross | R1 | Triangle | L1 | — | Circle | Square | L2 | R2 | Circle | 0.05 | 0.59 | 2.70 | 2.90 | 110 | 270 | 90 | -5.0 | 0.35 | 10.00 | 1.80 | Toggle | No | 2025-11-10 | 2026-09-29 |
| [Gunz](https://liquipedia.net/rocketleague/index.php?title=Gunz&oldid=2110904) | pro | M26 | PS | Cross | Circle | L1 | Square | — | — | Triangle | L2 | R2 | Cross | 0.05 | 0.65 | 2.00 | 2.00 | 110 | 270 | 100 | -3.0 | 0.45 | 10.00 | 1.30 | Toggle | No | 2026-06-06 | 2026-10-21 |
| [Gus](https://liquipedia.net/rocketleague/index.php?title=Gus&oldid=2084872) | pro | M26 | PS | Cross | Circle | L1 | L1 | L2 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.70 | 1.80 | 1.80 | 110 | 270 | 100 | -3.0 | 0.35 | 7.00 | 1.40 | Toggle | No | 2026-01-04 | 2026-07-27 |
| [Hisoka](https://liquipedia.net/rocketleague/index.php?title=Hisoka&oldid=2110300) | pro | M26 | PS | Cross | Circle | L1 | — | R3 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.50 | 2.80 | 3.00 | 110 | 270 | 100 | -4.0 | 0.40 | 6.00 | 1.40 | Toggle | No | 2022-01-24 | 2026-10-19 |
| [Joreuz](https://liquipedia.net/rocketleague/index.php?title=Joreuz&oldid=2105881) | pro | M26 | PS | Cross | Circle | R1 | R1 | L1 | — | Triangle | L2 | R2 | Circle | 0.07 | 0.70 | 1.77 | 1.77 | 110 | 270 | 100 | -3.0 | 0.35 | 4.70 | 1.20 | Toggle | No | 2024-09-14 | 2026-09-30 |
| [Joyo](https://liquipedia.net/rocketleague/index.php?title=Joyo&oldid=2111714) | pro | M26 | PS | Cross | R1 | L1 | L1 | Square | Circle | Triangle | L2 | R2 | Circle | 0.05 | 0.60 | 2.00 | 2.00 | 110 | 270 | 100 | -3.0 | 0.40 | 6.50 | 1.30 | Toggle | No | 2025-11-17 | 2026-10-23 |
| [Juicy (French Player)](https://liquipedia.net/rocketleague/index.php?title=Juicy_(French_Player)&oldid=2106075) | pro | M26 | PS | Cross | R1 | L1 | L1 | Circle | Square | Triangle | L2 | R2 | Cross | 0.07 | 0.55 | 1.40 | 1.40 | 110 | 270 | 90 | -4.0 | 0.45 | 7.20 | 1.20 | Toggle | No | 2025-11-10 | 2026-10-01 |
| [Kiileerrz](https://liquipedia.net/rocketleague/index.php?title=Kiileerrz&oldid=2107483) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Circle | 0.07 | 0.80 | 2.00 | 2.00 | 110 | 270 | 100 | -5.0 | 0.40 | 10.00 | 1.50 | Toggle | No | 2025-10-19 | 2026-10-05 |
| [Kofyr](https://liquipedia.net/rocketleague/index.php?title=Kofyr&oldid=2106169) | pro | M26 | PS | Cross | R1 | L1 | L1 | — | Square | Triangle | L2 | R2 | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 260 | 90 | -3.0 | 0.35 | 4.00 | 1.00 | Toggle | No | 2026-06-03 | 2026-10-01 |
| [Lj](https://liquipedia.net/rocketleague/index.php?title=Lj&oldid=2109450) | pro | M26 | PS | Cross | Circle | L1 | L1 | R1 | — | Triangle | L2 | R2 | Cross | 0.08 | 0.70 | 1.60 | 1.60 | 110 | 270 | 100 | -5.0 | 0.55 | 5.00 | 1.30 | Toggle | No | 2025-03-16 | 2026-10-17 |
| [Lostt](https://liquipedia.net/rocketleague/index.php?title=Lostt&oldid=2107949) | pro | M26 | PS | Cross | Circle | Square | R1 | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.52 | 2.20 | 2.20 | 110 | 270 | 90 | -5.0 | 0.35 | 7.00 | 1.60 | Toggle | No | 2025-03-30 | 2026-10-08 |
| [M0nkey M00n](https://liquipedia.net/rocketleague/index.php?title=M0nkey_M00n&oldid=2107585) | pro | M26 | PS | Cross | Circle | Square | L2 | — | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.60 | 2.93 | 2.93 | 110 | 270 | 100 | -3.0 | 0.50 | 4.00 | 1.10 | Toggle | No | 2025-12-20 | 2026-10-06 |
| [Nass](https://liquipedia.net/rocketleague/index.php?title=Nass&oldid=2106078) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.70 | 1.60 | 1.60 | 110 | 270 | 90 | -5.0 | 0.35 | 6.10 | 1.80 | Toggle | No | 2026-02-24 | 2026-10-01 |
| [Nwpo](https://liquipedia.net/rocketleague/index.php?title=Nwpo&oldid=2106065) | pro | M26 | PS | Cross | Circle | Square | L2 | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.70 | 1.40 | 1.40 | 110 | 270 | 90 | -4.0 | 0.40 | 4.00 | 1.50 | Toggle | No | 2026-08-15 | 2026-10-01 |
| [Oaly](https://liquipedia.net/rocketleague/index.php?title=Oaly&oldid=2111829) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Square | 0.05 | 0.57 | 1.50 | 1.50 | 110 | 270 | 100 | -3.0 | 0.40 | 4.70 | 1.20 | Toggle | No | 2024-06-10 | 2026-10-23 |
| [Oski](https://liquipedia.net/rocketleague/index.php?title=Oski&oldid=2106082) | pro | M26 | PS | Cross | R1 | Square | — | Square | L1 | Triangle | L2 | R2 | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 270 | 90 | -4.0 | 0.40 | 7.00 | 1.50 | Toggle | No | 2023-12-15 | 2026-10-01 |
| [Reveal](https://liquipedia.net/rocketleague/index.php?title=Reveal&oldid=2106097) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.88 | 1.88 | 110 | 270 | 90 | -4.0 | 0.40 | 5.00 | 1.10 | Toggle | No | 2023-11-05 | 2026-10-01 |
| [Reysbull](https://liquipedia.net/rocketleague/index.php?title=Reysbull&oldid=2107952) | pro | M26 | PS | Cross | Circle | L1 | R1 | L1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.77 | 2.34 | 2.41 | 110 | 270 | 110 | -2.0 | 0.45 | 4.50 | 1.80 | Toggle | No | 2025-01-22 | 2026-10-08 |
| [Rw9](https://liquipedia.net/rocketleague/index.php?title=Rw9&oldid=2106098) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | — | Triangle | L2 | R2 | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 270 | 100 | -5.0 | 0.35 | 3.50 | 1.10 | Toggle | No | 2025-06-30 | 2026-10-01 |
| [Seikoo](https://liquipedia.net/rocketleague/index.php?title=Seikoo&oldid=2108146) | pro | M26 | PS | Cross | R1 | Square | L1 | L3 | Circle | Triangle | L2 | R2 | Cross | 0.07 | 0.68 | 1.40 | 1.80 | 110 | 240 | 100 | -3.0 | 0.50 | 4.40 | 1.40 | Toggle | No | 2025-11-17 | 2026-10-09 |
| [Snowyy](https://liquipedia.net/rocketleague/index.php?title=Snowyy&oldid=2105769) | pro | M26 | Xbox | A | B | X | LB | — | — | Y | LT | RT | Cross | 0.08 | 0.50 | 1.60 | 1.40 | 110 | 270 | 100 | -5.0 | 0.40 | 10 | 1.10 | Toggle | No | 2020-11-08 | 2026-09-29 |
| [Stizzy](https://liquipedia.net/rocketleague/index.php?title=Stizzy&oldid=2110299) | pro | M26 | PS | Cross | R1 | Square | — | Square | Circle | Triangle | L2 | R2 | Cross | 0.09 | 0.20 | 1.90 | 1.90 | 110 | 270 | 100 | -3.0 | 0.35 | 4.00 | 1.50 | Toggle | No | 2023-05-21 | 2026-10-19 |
| [Superlachie](https://liquipedia.net/rocketleague/index.php?title=Superlachie&oldid=2002206) | pro | M26 | PS | Cross | Circle | L1 | L1 | — | R1 | Triangle | L2 | R2 | Cross | 0.10 | 0.10 | 2.29 | 2.19 | 110 | 270 | 100 | -3.0 | 0.45 | 5.00 | 1.20 | Toggle | No | 2023-09-23 | 2026-03-19 |
| [Swiftt](https://liquipedia.net/rocketleague/index.php?title=Swiftt&oldid=2107950) | pro | M26 | PS | Cross | Circle | Square | L1 | — | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.75 | 2.00 | 1.50 | 110 | 270 | 100 | -3.0 | 0.35 | 10.00 | 2.00 | Toggle | No | 2025-01-05 | 2026-10-08 |
| [Tawk](https://liquipedia.net/rocketleague/index.php?title=Tawk&oldid=2108742) | pro | M26 | PS | Cross | Circle | Square | — | L1 | Square | Triangle | L2 | R2 | Cross | 0.07 | 0.65 | 1.50 | 1.50 | 109 | 270 | 90 | -4.0 | 0.45 | 7.40 | 1.60 | Toggle | No | 2025-12-11 | 2026-10-12 |
| [TehQoz](https://liquipedia.net/rocketleague/index.php?title=TehQoz&oldid=2105831) | pro | M26 | PS | Cross | Circle | Square | Square | L2 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.65 | 2.00 | 2.00 | 110 | 270 | 100 | -3.0 | 0.35 | 5.50 | 1.40 | Toggle | No | 2024-01-31 | 2026-09-30 |
| [Trk511](https://liquipedia.net/rocketleague/index.php?title=Trk511&oldid=2106092) | pro | M26 | PS | Cross | Circle | Square | R1 | — | L1 | Triangle | L2 | R2 | Circle | 0.09 | 0.20 | 2.70 | 2.90 | 110 | 270 | 100 | -5.0 | 0.40 | 5.70 | 1.00 | Toggle | No | 2023-12-15 | 2026-10-01 |
| [Vatira](https://liquipedia.net/rocketleague/index.php?title=Vatira&oldid=2106073) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.65 | 1.50 | 1.50 | 110 | 270 | 90 | -5.0 | 0.35 | 7.10 | 1.50 | Toggle | No | 2025-11-17 | 2026-10-01 |
| [Vortexioz](https://liquipedia.net/rocketleague/index.php?title=Vortexioz&oldid=2094856) | pro | M26 | PS | Cross | Circle | L1 | L1 | — | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.75 | 1.25 | 1.50 | 110 | 270 | 100 | -4.0 | 0.45 | 7.00 | 1.20 | Toggle | No | 2019-06-07 | 2026-08-17 |
| [Wahvey](https://liquipedia.net/rocketleague/index.php?title=Wahvey&oldid=2106060) | pro | M26 | PS | Cross | Circle | L1 | L1 | — | R1 | Triangle | L2 | R2 | Circle | 0.07 | 0.81 | 1.98 | 2.00 | 110 | 260 | 90 | -3.0 | 0.45 | 5.4 | 1.40 | Toggle | No | 2023-09-19 | 2026-10-01 |
| [Yanxnz](https://liquipedia.net/rocketleague/index.php?title=Yanxnz&oldid=2107948) | pro | M26 | PS | Cross | Circle | Square | L2 | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.65 | 1.40 | 1.40 | 110 | 270 | 90 | -5,0 | 0.35 | 10.00 | 2.00 | Toggle | No | 2026-09-20 | 2026-10-08 |
| [Zach](https://liquipedia.net/rocketleague/index.php?title=Zach&oldid=2106062) | pro | M26 | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.10 | 0.60 | 1.85 | 1.30 | 110 | 260 | 100 | -4.0 | 0.35 | 4.50 | 1.30 | Toggle | No | 2025-01-09 | 2026-10-01 |
| [Zen](https://liquipedia.net/rocketleague/index.php?title=Zen&oldid=2111703) | pro | M26 | PS | Cross | Circle | Square | R1 | L2 | — | Triangle | L2 | R2 | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 270 | 100 | -3.0 | 0.35 | 4.00 | 1.40 | Toggle | No | 2026-02-12 | 2026-10-23 |
| [Al0t](https://liquipedia.net/rocketleague/index.php?title=Al0t&oldid=1996439) | creator | V | PS | Cross | Circle | L1 | L1 | — | — | Triangle | L2 | R2 | Cross | 0.05 | 0.75 | 2.00 | 2.00 | 110 | 270 | 110 | -3.0 | 1.00 | 3.00 | 1.20 | Toggle | No | 2021-02-05 | 2026-03-01 |
| [Allushin](https://liquipedia.net/rocketleague/index.php?title=Allushin&oldid=1939822) | pro | V | PS | Cross | L1 | R1 | R1 | Square | Circle | Triangle | L2 | R2 | Cross | 0.05 | 0.40 | 1.30 | 1.30 | 110 | 270 | 100 | -5.0 | 0.45 | 5.00 | 1.00 | Toggle | No | 2019-10-13 | 2025-11-22 |
| [Alpha54](https://liquipedia.net/rocketleague/index.php?title=Alpha54&oldid=2107588) | pro | V | PS | Cross | Circle | Square | Square | — | — | Triangle | L2 | R2 | Cross | 0.06 | 0.50 | 1.50 | 1.50 | 110 | 270 | 110 | -3.0 | 0.35 | 3.70 | 1.00 | Toggle | No | 2022-05-07 | 2026-10-06 |
| [Arsenal](https://liquipedia.net/rocketleague/index.php?title=Arsenal&oldid=2000391) | pro | V | PS | Cross | R1 | L1 | L1 | Square | Circle | Triangle | L2 | R2 | Square | 0.05 | 0.20 | 1.30 | 1.30 | 110 | 270 | 100 | -3.0 | 0.35 | 4.20 | 1.30 | Toggle | No | 2025-08-22 | 2026-03-15 |
| [AztraL](https://liquipedia.net/rocketleague/index.php?title=AztraL&oldid=2111326) | pro | V | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 270 | 100 | -3.0 | 0.35 | 6.00 | 1.40 | Toggle | No | 2025-11-10 | 2026-10-22 |
| [Calix](https://liquipedia.net/rocketleague/index.php?title=Calix&oldid=1939934) | pro | V | PS | Square | Cross | L1 | L1 | — | R1 | Triangle | L2 | R2 | — | — | — | — | — | 110 | 270 | 110 | -3.0 | 0.65 | 10.00 | 1.50 | Toggle | No | 2021-05-09 | 2025-11-22 |
| [Chausette45](https://liquipedia.net/rocketleague/index.php?title=Chausette45&oldid=2077655) | pro | V | PS | Cross | Circle | Square | Square | R1 | — | Triangle | L2 | R2 | Cross | 0.06 | 0.50 | 1.45 | 1.40 | 110 | 270 | 100 | -4.0 | 0.45 | 10.00 | 1.30 | Toggle | No | 2021-03-29 | 2026-07-07 |
| [Chicago](https://liquipedia.net/rocketleague/index.php?title=Chicago&oldid=1996408) | pro | V | PS | Cross | Circle | L1 | L1 | R1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.63 | 2.00 | 2.00 | 110 | 270 | 100 | -3.0 | 0.40 | 4.70 | 1.30 | Toggle | No | 2023-12-15 | 2026-03-01 |
| [Comm](https://liquipedia.net/rocketleague/index.php?title=Comm&oldid=2099979) | pro | V | PS | Cross | Circle | L1 | L1 | — | R1 | Triangle | L2 | R2 | Cross | 0.10 | 0.50 | 1.30 | 1.30 | 110 | 270 | 100 | -4.0 | 0.45 | 3.20 | 1.00 | Toggle | No | 2020-11-28 | 2026-09-05 |
| [Dappur](https://liquipedia.net/rocketleague/index.php?title=Dappur&oldid=1940004) | pro | V | PS | Cross | Circle | Square | Square | L1 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.50 | 1.40 | 1.40 | 110 | 270 | 100 | -4.0 | 0.45 | 6.00 | 1.20 | Toggle | No | 2020-03-30 | 2025-11-22 |
| [Doomsee](https://liquipedia.net/rocketleague/index.php?title=Doomsee&oldid=1940030) | pro | V | PS | Cross | Circle | Square | — | L1 | R1 | Triangle | L2 | R2 | — | — | — | — | — | 105 | 270 | 110 | -4.0 | 0.60 | 10.00 | 1.10 | Toggle | No | 2021-05-09 | 2025-11-22 |
| [Fairy Peak](https://liquipedia.net/rocketleague/index.php?title=Fairy_Peak&oldid=2103885) | pro | V | PS | Cross | Circle | L1 | L1 | — | R2 | Triangle | L2 | R1 | Cross | 0.07 | 0.65 | 2.50 | 3.29 | 110 | 270 | 100 | -3.0 | 0.35 | 4.70 | 1.40 | Toggle | No | 2025-02-07 | 2026-09-23 |
| [Fireburner](https://liquipedia.net/rocketleague/index.php?title=Fireburner&oldid=1996434) | pro | V | PS | Cross | R1 | Square | L1 | — | — | Triangle | L2 | R2 | Cross | 0.05 | 0.83 | 2.30 | 2.30 | 110 | 270 | 100 | -3.0 | 0.50 | 10.00 | 1.40 | Toggle | No | 2021-04-13 | 2026-03-01 |
| [Flakes](https://liquipedia.net/rocketleague/index.php?title=Flakes&oldid=1940100) | pro | V | PS | Cross | L1 | R1 | R1 | — | Square | Triangle | L2 | R2 | Cross | 0.07 | 0.75 | 1.20 | 1.20 | 107 | 310 | 100 | -5.0 | 1.00 | 8.00 | 1.50 | Toggle | No | 2023-12-15 | 2025-11-22 |
| [GarrettG](https://liquipedia.net/rocketleague/index.php?title=GarrettG&oldid=2108698) | creator | V | PS | Cross | R1 | Square | — | Circle | L1 | Triangle | L2 | R2 | Cross | 0.05 | 0.75 | 1.50 | 1.50 | 110 | 270 | 100 | -3.0 | 0.35 | 4.20 | 1.40 | Toggle | No | 2023-12-15 | 2026-10-11 |
| [Gibbs](https://liquipedia.net/rocketleague/index.php?title=Gibbs&oldid=2105793) | pro | V | Xbox | A | LB | X | X | — | — | Y | LT | RT | — | — | — | — | — | 110 | 400 | 140 | -3.0 | 0.10 | 2.40 | 1.50 | Toggle | No | 2019-03-07 | 2026-09-30 |
| [Gimmick](https://liquipedia.net/rocketleague/index.php?title=Gimmick&oldid=1996425) | pro | V | PS | Circle | Cross | Square | Square | L2 | — | Triangle | L1 | R1 | Cross | 0.05 | 0.70 | 1.45 | 1.35 | 110 | 270 | 100 | -3.0 | 0.35 | 10.00 | 1.00 | Toggle | No | 2021-06-23 | 2026-03-01 |
| [Jessie](https://liquipedia.net/rocketleague/index.php?title=Jessie&oldid=1940198) | creator | V | PS | Cross | R1 | L1 | L1 | Square | — | Triangle | L2 | R2 | Cross | 0.04 | 0.68 | 1.20 | 1.20 | 110 | 270 | 100 | -3.0 | 0.35 | 7.00 | 2.00 | Toggle | No | 2021-04-28 | 2025-11-22 |
| [JKnaps](https://liquipedia.net/rocketleague/index.php?title=JKnaps&oldid=2092859) | pro | V | PS | Cross | R1 | L1 | L1 | — | — | Triangle | L2 | R2 | Cross | 0.05 | 0.45 | 2.00 | 2.00 | 109 | 300 | 100 | -3.0 | 0.60 | 3.10 | 1.30 | Toggle | No | 2023-12-15 | 2026-08-16 |
| [Jstn](https://liquipedia.net/rocketleague/index.php?title=Jstn&oldid=2107775) | pro | V | PS | Cross | Circle | R1 | R1 | Square | — | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.30 | 1.30 | 110 | 270 | 100 | -3.0 | 0.35 | 4.70 | 1.30 | Toggle | No | 2025-12-11 | 2026-10-06 |
| [Kassio](https://liquipedia.net/rocketleague/index.php?title=Kassio&oldid=2084969) | pro | V | PS | Cross | R1 | Square | L1 | — | Circle | Triangle | L2 | R2 | Square | 0.10 | 0.50 | 1.20 | 1.30 | 110 | 260 | 110 | -3.0 | 0.60 | 4.50 | 1.40 | Toggle | No | 2020-09-15 | 2026-07-27 |
| [Kaydop](https://liquipedia.net/rocketleague/index.php?title=Kaydop&oldid=2017104) | pro | V | PS | Cross | R1 | L1 | L1 | Triangle | — | Square | L2 | R2 | Cross | 0.08 | 0.75 | 1.50 | 1.50 | 110 | 270 | 100 | -3.0 | 0.35 | 4.00 | 1.00 | Toggle | No | 2024-10-28 | 2026-04-17 |
| [Kevpert](https://liquipedia.net/rocketleague/index.php?title=Kevpert&oldid=2094384) | pro | V | PS | Cross | Circle | Paddle (as D-pad right) | Paddle (as D-pad right) | L2 | R2 | Triangle | L2 | R1 | Square | 0.05 | 0.80 | 1.17 | 1.17 | 110 | 270 | 90 | -5.0 | 0.45 | 2.30 | 1.00 | Toggle | No | 2023-08-10 | 2026-08-17 |
| [Kronovi](https://liquipedia.net/rocketleague/index.php?title=Kronovi&oldid=1999180) | creator | V | PS | Cross | Circle | L1 | L1 | Square | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.85 | 1.40 | 1.40 | 110 | 260 | 100 | -3.0 | 0.45 | 1.50 | 1.40 | Toggle | No | 2021-12-29 | 2026-03-12 |
| [Kuxir97](https://liquipedia.net/rocketleague/index.php?title=Kuxir97&oldid=2103725) | pro | V | PS | Cross | Circle | Square | Square | — | — | Triangle | L2 | R2 | Cross | 0.06 | 0.65 | 1.60 | 1.60 | 110 | 270 | 100 | -3.0 | 0.55 | 5.00 | 1.20 | Hold | No | 2023-08-02 | 2026-09-22 |
| [Kv1](https://liquipedia.net/rocketleague/index.php?title=Kv1&oldid=2105771) | pro | V | Xbox | A | B | X | — | RB | LB | Y | LT | RT | Cross | 0.06 | 0.75 | 1.55 | 1.55 | 110 | 270 | 100 | -5.0 | 0.30 | 10.00 | 2.00 | Toggle | No | 2026-08-15 | 2026-09-29 |
| [Lachinio](https://liquipedia.net/rocketleague/index.php?title=Lachinio&oldid=1996450) | pro | V | PS | Cross | R1 | L1 | L1 | — | Square | Triangle | L2 | R2 | Cross | 0.10 | 0.65 | 1.10 | 1.20 | 110 | 280 | 110 | -3.0 | 0.45 | 5.00 | 1.20 | Toggle | No | 2019-01-28 | 2026-03-01 |
| [Lethamyr](https://liquipedia.net/rocketleague/index.php?title=Lethamyr&oldid=1999281) | creator | V | Xbox | A | B | LB | LB | — | — | Y | LT | RT | Cross | 0.10 | 0.80 | 1.00 | 1.00 | 110 | 270 | 110 | -4.0 | 0.55 | 5.00 | 1.50 | Toggle | No | 2020-11-22 | 2026-03-13 |
| [Markydooda](https://liquipedia.net/rocketleague/index.php?title=Markydooda&oldid=1996442) | pro | V | Xbox | A | B | X | X | — | — | Y | LT | RT | Cross | 0.02 | 0.76 | 1.00 | 1.50 | 108 | 280 | 110 | -4.0 | 0.50 | 6.90 | 1.00 | Hold | No | 2022-04-21 | 2026-03-01 |
| [Mognus](https://liquipedia.net/rocketleague/index.php?title=Mognus&oldid=1996438) | pro | V | PS | Cross | Circle | Square | Square | L1 | — | Triangle | L2 | R2 | Cross | 0.08 | 0.50 | 2.00 | 2.00 | 108 | 260 | 100 | -3.0 | 0.65 | 8.00 | 1.00 | Toggle | No | 2020-11-25 | 2026-03-01 |
| [Musty](https://liquipedia.net/rocketleague/index.php?title=Musty&oldid=1907433) | creator | V | Xbox | A | B | LB | LB | — | RB | Y | LT | RT | Square | 0.10 | 0.70 | 1.25 | 1.10 | 109 | 270 | 100 | -4.0 | 0.35 | 6.00 | 1.20 | Toggle | No | 2022-01-13 | 2025-09-24 |
| [Noly](https://liquipedia.net/rocketleague/index.php?title=Noly&oldid=2084917) | pro | V | PS | Cross | Circle | L1 | L1 | R1 | — | Triangle | L2 | R2 | Cross | 0.05 | 0.50 | 2.00 | 2.00 | 110 | 270 | 90 | -4.0 | 0.35 | 10.00 | 1.50 | Toggle | No | 2023-01-27 | 2026-07-27 |
| [Paschy90](https://liquipedia.net/rocketleague/index.php?title=Paschy90&oldid=1996446) | creator | V | PS | Cross | Circle | Square | L1 | — | — | Triangle | L2 | R2 | — | — | — | — | — | 110 | 270 | 100 | -3.0 | 0.45 | 5.00 | 1.80 | Toggle | No | 2021-07-12 | 2026-03-01 |
| [Remkoe](https://liquipedia.net/rocketleague/index.php?title=Remkoe&oldid=1996432) | pro | V | Xbox | A | B | LB | LB | — | — | Y | LT | RT | Square | 0.10 | 0.75 | 1.42 | 1.42 | 110 | 270 | 90 | -5.0 | 0.40 | 6.00 | 1.80 | Toggle | No | 2019-05-01 | 2026-03-01 |
| [Retals](https://liquipedia.net/rocketleague/index.php?title=Retals&oldid=2105765) | pro | V | PS | Cross | Circle | Square | L1 | L2 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.30 | 1.30 | 110 | 270 | 100 | -4.00 | 0.45 | 3.60 | 1.70 | Toggle | No | 2024-01-06 | 2026-09-29 |
| [Rise](https://liquipedia.net/rocketleague/index.php?title=Rise&oldid=2111819) | pro | V | PS | Cross | Circle | L1 | L1 | R1 | Square | Triangle | L2 | R2 | Cross | 0.05 | 0.60 | 1.60 | 1.60 | 110 | 270 | 100 | -5.0 | 0.40 | 6.00 | 1.30 | Toggle | No | 2025-02-09 | 2026-10-23 |
| [Rizzo](https://liquipedia.net/rocketleague/index.php?title=Rizzo&oldid=1996427) | creator | V | Xbox | X | A | RB | LT | — | — | Y | Left stick | Left stick | Cross | 0.10 | 0.74 | 2.30 | 2.30 | 110 | 270 | 100 | -5.0 | 0.40 | 4.00 | 1.20 | Toggle | No | 2022-05-01 | 2026-03-01 |
| [Scrub Killa](https://liquipedia.net/rocketleague/index.php?title=Scrub_Killa&oldid=2069697) | pro | V | PS | Cross | Circle | Square | Square | — | — | Triangle | L2 | R2 | Cross | 0.07 | 0.70 | 1.30 | 1.30 | 110 | 280 | 90 | -4.0 | 0.50 | 7.90 | 1.10 | Toggle | No | 2024-08-26 | 2026-06-17 |
| [Sizz](https://liquipedia.net/rocketleague/index.php?title=Sizz&oldid=1917242) | creator | V | PS | Cross | Circle | Square | L1 | — | R1 | Triangle | L2 | R2 | Cross | 0.15 | 0.75 | 1.60 | 1.30 | 110 | 280 | 90 | -4.0 | 0.45 | 4.00 | 1.30 | Toggle | No | 2021-08-04 | 2025-10-11 |
| [Speed](https://liquipedia.net/rocketleague/index.php?title=Speed&oldid=2085855) | pro | V | PS | Cross | R1 | Square | L1 | — | — | Triangle | L2 | R2 | Cross | 0.08 | 0.50 | 1.70 | 1.40 | 109 | 260 | 110 | -3.0 | 0.60 | 4.00 | 1.20 | Toggle | No | 2019-10-12 | 2026-07-31 |
| [SquishyMuffinz](https://liquipedia.net/rocketleague/index.php?title=SquishyMuffinz&oldid=2107859) | creator | V | PS | Cross | Circle | L1 | L1 | — | R1 | Triangle | L2 | R2 | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 270 | 90 | -5.0 | 0.35 | 7.00 | 1.30 | Toggle | No | 2026-07-10 | 2026-10-07 |
| [Sypical](https://liquipedia.net/rocketleague/index.php?title=Sypical&oldid=1996396) | pro | V | PS | Cross | R1 | L1 | L1 | — | Square | Triangle | L2 | R2 | Cross | 0.05 | 0.70 | 1.30 | 1.30 | 110 | 270 | 100 | -5.0 | 0.40 | 4.70 | 1.20 | Toggle | No | 2022-07-24 | 2026-03-01 |
| [Thanovic](https://liquipedia.net/rocketleague/index.php?title=Thanovic&oldid=1942161) | creator | V | PS | Cross | R1 | L1 | L1 | Square | Circle | Triangle | L2 | R2 | Cross | 0.05 | 0.50 | 1.80 | 1.80 | 110 | 270 | 100 | -5.0 | 0.45 | 6.00 | 1.50 | Toggle | No | 2022-04-14 | 2025-11-23 |
| [Torment](https://liquipedia.net/rocketleague/index.php?title=Torment&oldid=2086117) | pro | V | PS | Cross | R1 | L1 | L1 | Circle | Square | Triangle | L2 | R2 | Cross | 0.05 | 0.50 | 1.40 | 1.40 | 110 | 270 | 90 | -5.0 | 0.35 | 8.00 | 1.40 | Toggle | No | 2022-10-25 | 2026-08-01 |
| [Turbopolsa](https://liquipedia.net/rocketleague/index.php?title=Turbopolsa&oldid=2105263) | pro | V | PS | Cross | L1 | Square | Square | — | R1 | Triangle | L2 | R2 | Cross | 0.10 | 0.55 | 1.40 | 1.60 | 110 | 270 | 100 | -4.0 | 0.40 | 4.40 | 1.50 | Toggle | No | 2022-04-30 | 2026-09-27 |
| [ViolentPanda](https://liquipedia.net/rocketleague/index.php?title=ViolentPanda&oldid=2109449) | pro | V | PS | Cross | R1 | L1 | L1 | Square | Circle | Triangle | L2 | R2 | Cross | 0.06 | 0.65 | 2.00 | 2.00 | 110 | 270 | 100 | -3.0 | 0.40 | 3.50 | 1.00 | Toggle | No | 2021-04-14 | 2026-10-17 |
| [Wonder](https://liquipedia.net/rocketleague/index.php?title=Wonder&oldid=1905367) | pro | V | Xbox | A | B | LB | LB | X | RB | Y | LT | RT | — | — | — | — | — | 110 | 270 | 90 | -5.0 | 0.35 | 5.00 | 1.30 | Toggle | No | 2019-02-27 | 2025-09-23 |
| [Zineel](https://liquipedia.net/rocketleague/index.php?title=Zineel&oldid=2085948) | pro | V | PS | Cross | Circle | Square | — | L1 | R1 | Triangle | L2 | R2 | Cross | 0.05 | 0.60 | 1.30 | 1.30 | 110 | 270 | 90 | -4.0 | 0.40 | 6.00 | 1.30 | Toggle | No | 2022-06-11 | 2026-08-01 |
| [Eraclesss](https://liquipedia.net/rocketleague/index.php?title=Eraclesss&oldid=2103895) | pro | K | Xbox | X | A | B | — | LB | RB | Y | LT | RT | Cross | 0.07 | 0.80 | 1.50 | 1.50 | 110 | 270 | 100 | -5.0 | 0.35 | 5.50 | 1.40 | Toggle | No | 2023-12-05 | 2026-09-23 |

Pages with a camera table only (in the camera statistics, not above): [2Piece](https://liquipedia.net/rocketleague/index.php?title=2Piece&oldid=2106080), [Abdullah](https://liquipedia.net/rocketleague/index.php?title=Abdullah&oldid=2103828), [Kevin](https://liquipedia.net/rocketleague/index.php?title=Kevin&oldid=2105762), [M7md](https://liquipedia.net/rocketleague/index.php?title=M7md&oldid=2108942), [Sad](https://liquipedia.net/rocketleague/index.php?title=Sad&oldid=2105773), [Sphinx](https://liquipedia.net/rocketleague/index.php?title=Sphinx&oldid=2105761).

## Notes on the data

- Two pages carry a parameter the template ignores (so Liquipedia does not show it): Astra `air_roll-left=Q` (read here as Air roll L), Gunz `left=r1` (not used).
- One page (Cavemanben) adds `camera_swivel_right=Left Control` (KBM).
- One camera table (Joyo) adds `demotransitiontime=0.00` and `invertswivel=no`.
- Eraclesss has two control tables (Xbox and KBM); both are listed.
- Values outside the page's slider grid (client/src/settings/settings.ts limits and steps): Cyrexal camera.transitionspeed=0, Smoog camera.transitionspeed=0.40.

## Carball's own inputs: what needs a real device (RV-1129, INFO)

Not testable here, so left as built: the wheel's notch size on each browser and mouse (a tap a 40 px notch or a line), a
trackpad's or a free-spin wheel's tap rate, Shift+wheel in Firefox, whether Windows' Snipping Tool still lets PrintScreen's
keyup reach the page, the right-click swallow's timing on Windows (its context menu within one task of the release), and
whether `overscroll-behavior-x: none` stops a trackpad's swipe-back in each browser (RV-1136).
