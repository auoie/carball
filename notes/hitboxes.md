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
