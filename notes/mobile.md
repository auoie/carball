# Mobile web

Phones and tablets play every mode (free play, Play vs Bots, custom training, online matches in the same queues as
everyone else): the user's request of 2026-11-10. Landscape only. This note is the design; the code is
`client/src/input/touch.ts` (the controls), `client/src/input/mapping.ts` (their reading) and
`client/src/input/devices.ts` (the stick on a pad).

## Platform

- **WebTransport on iPhones:** Safari 26.4 (March 2026) shipped it on iOS and macOS (WebKit's "WebKit Features for
  Safari 26.4"; MDN marks the API Baseline 2026). Every iPhone browser is WebKit, so an iPhone on iOS 26.4 or later
  plays online; an older one, and any browser without WebTransport, plays the offline modes: Find Match off, with why
  under it, and no region pings (`client/src/ui/platformNotices.ts`).
- **Datagrams required:** every WebTransport session opens with `requireUnreliable: true`, and one ready without them
  (WebKit falls back to HTTP/2 when QUIC is blocked, which has none, and our QUIC servers don't serve it) is refused as a
  server that can't be reached (`webTransportOptions`, `checkDatagrams` in connection.ts).
- **Bots:** onnxruntime-web needs WebAssembly SIMD, and on an iPhone or iPad iOS 17.5 or later (JavaScriptCore fails it
  before). Where either is missing, Play vs Bots says why and has no Start. Whether ORT starts within an iPhone's memory
  is a real phone's question.
- **Full screen:** a touch device asks for it at its first touch whatever the Display Mode setting (`DisplayMode`, its
  `fullscreen || touchDevice()`), and turns to landscape once in it where the browser allows (Android's
  `screen.orientation.lock`). A touch's user activation comes as the finger lifts, so the lift asks too (pointerup,
  touchend). Left by the player (Android's edge swipe, its back gesture), it comes back at the next tap: the user's
  phone, 2026-11-10 (a desktop's Escape is respected, as ever). iPhone Safari has no element full screen: the web app manifest (`public/manifest.json`: 192 and 512 px
  icons and a maskable one, rendered from favicon.svg, as Chrome's install wants: RV-1228) and a hint on an iPhone ("Tap
  Share, then Add to Home Screen") make the home-screen app the way, dismissed once for good. An iPad's Safari has
  element full screen (16.4 on): its hint only where that's missing (RV-1226).
- **Storage:** Safari erases a site's storage after 7 days without a visit (not a home-screen app's, which starts with
  storage of its own, so it signs in again; the hint says both). Settings fall back to their defaults when storage is
  empty, so nothing breaks; local training packs are what's lost.
- **The screen kept on** in play on a touch device (`navigator.wakeLock`), let go under a menu, taken again when the page
  comes back.
- **Sound:** unlocked by a touch's end or a click too (iOS Safari doesn't start audio from a finger landing).
- **GPU:** a touch device gets the weak-GPU defaults (an iPhone's WebGL says only "Apple GPU": Render Quality
  Performance, 70 % each way; Render Detail Quality, no bloom or depth of field) and a pixel ratio of 1.5 at most (2
  elsewhere).
- **Frame rate:** a touch device draws 60 frames a second at most by default (Settings → Touch → Frame Rate: 60, 30,
  Uncapped): a 120 Hz phone (the user's OnePlus 10 Pro, 2026-11-10: choppy, delayed, hot) drew twice that for nothing
  but heat. The loop skips animation frames until one is due (`FramePacer`, phase-locked to the screen: a frame counts
  as due up to a quarter of the cap's interval early, but under half the screen's measured refresh, so jitter never
  decides it; its cadence pulled a tenth of the way to the frames it lands on, so a screen a little off its rate
  (119.88 Hz) never drifts into an uneven frame: RV-1245; after a missed vsync the cadence starts from the late frame,
  so the next keeps the interval, 3 then 2 refreshes at 120/60, not 3 then 1: RV-1254); physics keeps its 120 ticks a
  second, and the camera steps at the frames' rate (notes/camera.md). The automatic default's frame-rate guard
  takes frames at the cap as not slow, and on a touch device watches all session long (each window that wasn't slow
  followed by another), so a phone that slows as it heats steps down then, once. Settings → Interface → Stat Graphs
  shows the frame rate and times in touch play (on the left under the top row, clear of the boost ring and the buttons;
  touches pass through).
- **The end screen and the questions** (Exit's Yes, the pause menu's, the players menu's actions): 44 px on the screen
  on a touch device, the HUD's stage scale undone (`--stage-scale`, ~0.54 on a phone: RV-1239).
- **Pads:** a Bluetooth pad works as on a desktop. Safari's Xbox pad is the "Xbox Wireless Controller", so a bare
  "Wireless Controller" (a DualShock 4's name in some browsers) means PlayStation glyphs only without "Xbox".

## Controls (`client/src/input/touch.ts`)

Shown in play on a touch device (its main pointer coarse, or a touch since the page opened), hidden under every menu,
the training editor's own page and a match's end screen (its menu tapped, RV-1209). A real pad's button or stick hides
them until the next touch: a Bluetooth pad on a phone plays and works the menus as on a desktop; so does the mouse or
the keyboard (a touchscreen laptop's, a tablet's), and a mouse never drives the stick or presses a button (RV-1211).
They take every touch that lands on them, a stray one between the buttons too, and the mouse events a touch brings
after it are never a mouse's (no Jump (alternative) from a tap: RV-1210), told by the last press's kind, not by time (a
real click soon after a touch counts: RV-1223); while they're shown the first mouse click lands on them and only
switches to the mouse. Typing into a text field (the on-screen keyboard's too) doesn't count as the keyboard
(RV-1231). Every finger is let go when the page is
blurred, hidden, left or turned (RV-1213). Played by touch, the camera's settings are the controller's and the HUD's
prompts that name a key or a pad's button are left out (RV-1214, RV-1225: Jump skips the replay, Ball Cam is its own
button). The screen's wake lock asks once at a time, a lock that comes unwanted let go at once (RV-1224).

- **The stick:** a floating stick on the left half, centred where the thumb lands, 56 px of travel. It is a pad's left
  stick: `InputDevices` puts it on a virtual pad's axes 0 and 1 (merged with a real pad's, the tilt further from centre
  winning each axis), so steer, pitch, yaw, the controller deadzone, the dodge's direction and deadzone and air pitch
  safety are the controller's own. A flip is a pad's: jump twice with the stick tilted.
- **Throttle (Settings → Touch, `input/touchSettings.ts`; the user's choices after the research):**
  - **Stick** (the default, Sideswipe's; `stickThrottle` in mapping.ts): the stick's tilt past the deadzone drives
    forward, except in its bottom quarter (within 45 degrees of straight down), which reverses. Steering at full lock
    still drives. In the air the same stick pitches and yaws, as on a pad. Its cost (RV-1220): a stick tilted to drive
    makes a second jump a flip, so a double jump needs the stick centred (lift the thumb; air throttle is slight), and
    pulling back in the air throttles in reverse. The Touch tab says so; Auto drive and Split don't have it.
  - **Auto drive** (Rocket Racing's): always forward, a Brake button to slow and then reverse; the stick steers, pitches
    and yaws alone.
  - **Split** (the shooters' vehicles'): the stick steers alone; Gas and Reverse buttons.
- **The stick's own settings:** floating (where the thumb lands) or **fixed** (at its spot in the layout, taken by a
  thumb within twice its travel; a floating stick can turn a flip into a double jump when the thumb is placed again);
  its **size** (0.75–1.5 ×, its travel too), **sensitivity** (full tilt at 1 / this of its travel) and a **deadzone** of
  its own (radial, before the controller's per-axis one).
- **The layout editor** (Settings → Touch → Edit Button Layout): over everything, every button shown; a button dragged
  to its place (its centre at fractions of the screen, so another size of screen keeps it), the selected one Smaller,
  Bigger, Fainter, Stronger, hidden or shown; the fixed stick dragged too; Reset All; Done. Kept in its own record
  (`carball.touchLayout`, `{version, buttons, stick}`): read from any version, its values checked, a later page's buttons
  kept, so an update never wipes it; a later page's fields of a button kept too, an older tab's save not stripping them
  (RV-1236), its other fields, its stick's and its later version too (RV-1250). Reset Button Layout (and the editor's
  Reset All) puts every button back and clears the whole record, a later page's fields with it: what a reset means
  (RV-1256). The editor is its own screen (opaque; the settings covered under it, still the open menu, and back on Done:
  RV-1234, RV-1249; Escape or a pad's Start is Done); a piece stays whole inside the safe area at its size (RV-1235, on
  drag and whenever laid out: a Bigger after it, another screen, RV-1253), the fixed stick in the left half, where a
  thumb takes it, at its size now (RV-1233).
- **Auto drive in training:** a shot starts on any throttle, so Auto drive holds back while a shot waits in its
  Countdown until the stick or a driving button (Jump, Boost, Brake) is touched; Prev, Reset and Next put it back to
  waiting at once (their command moves the shot later in that frame, after its input is read: RV-1232). The wait is
  read as the input is, so a shot that comes to its Countdown inside the game's frame (training's Skip Goal Replay)
  waits too (RV-1246).
- **Buttons (actions, not pad buttons):** Jump (also the replay skip, as the pad's A), Boost, Slide (powerslide and air
  roll at once, as the default keyboard's right mouse button and the Legacy pad's X do; the default pad's X is powerslide
  alone, its air roll on LT: RV-1218; it reads "Air Roll" while the car is in the air, the user's phone, 2026-11-10),
  Ball cam. In the air the right thumb has Air Roll, Boost and Jump to choose between; the Touch tab's tip says to drag
  Slide to the left for a left finger (a button wins over the stick's zone). No air-roll toggle (the user: the label is
  enough). They press the actions directly: the default pad
  binds both Reverse and Air roll to LT, so pressing pad buttons would cross them. A tap shorter than a frame counts,
  as a key's tap; the jump's latch keeps it for a tick.
- **The top row:** Pause (the pause menu, as the pad's Start), then the mode's own: free play's Reset; training's
  Prev, Reset (the retry) and Next; online's Scores (held).
- **Multi-touch:** every finger its own pointer, captured where it lands.
- **Layout:** the stick's zone is the left half; Jump in the right thumb's corner, Boost left of it, Slide over it,
  Ball cam between; the top row top left (the scoreboard top centre stays clear). With `viewport-fit=cover` the page
  runs under a phone's notch: the controls, the HUD's stage (`windowStage`: the window less the safe area's insets,
  read from a probe's resolved padding), the main and pause menus and the settings keep inside the safe area
  (RV-1212); the 3D view alone fills the screen. In touch play the HUD's boost ring and flip lamp move to the stage's
  top right, out from under the buttons, the stat feed's rows under them (RV-1215).

## The page

- **Portrait:** a touch device held upright gets "Turn your phone sideways to play" over everything (the stylesheet's
  `(orientation: portrait) and (pointer: coarse)`).
- **No browser gestures in play:** `touch-action: none` on the game and the controls (no zoom, no scroll there; the
  menus can still be pinch-zoomed, an accessibility need: RV-1217), Safari's pinch stopped by its gesture events on a
  touch screen in touch play alone (the menus pinch on iOS too, RV-1227; a Mac's trackpad zooms as ever, RV-1216),
  `touch-action: manipulation` elsewhere (no double-tap zoom), no
  pull to refresh (`overscroll-behavior: none`), no long-press callout or tap flash, no text selection outside text
  fields. The game's height is the visible one (`100dvh`).

## The menus by touch

On a touch device (`html.touch-device`): every target 44 px tall at least (the editor's tags 40); sliders' and small
links' reach widened past their drawn size; text fields at 16 px, so Safari doesn't zoom into them; the settings' tabs
one row scrolled sideways. Nothing is hover-only (hover only highlights). The Controls page leaves out the keyboard's
notices (the windowed tab's binds, the browser's limits). The training editor turns by one finger and zooms by two
(pinch), and has its panel alone: the free camera is the keyboard's and the mouse's. Sign-in and sign-up are the
browser tests' 640 × 360 pages already; Turnstile's widget at a phone's size is a real phone's check.

## Clean points

1. Play by touch: the controls, the page's gestures, the rotate prompt, full screen, sound, the GPU defaults
   (2026-11-10).
2. Menus by touch: target sizes, nothing hover-only, the settings and the account pages (sign-in and Turnstile at
   phone size), the training editor by touch (its free camera, keyboard-only, hidden), the WebTransport notice, the
   web app manifest.
3. The touch settings (the throttle's models, the stick's), the layout editor, RX80's findings (2026-11-10).
4. RX81's findings, the user's first phone feedback (full screen back after an edge swipe, the Air Roll label, the
   frame rate cap and the guard following heat, the turning jitter: the camera on the ticks, notes/camera.md), SMOKE1's
   RV-1238 (no sound scheduled on a stopped context) and RV-1239 (the end screen's targets) (2026-11-10).
5. RX82's findings: the frame pacer phase-locked, the Skip Goal Replay wait, the online offsets per tick, the editor's
   cover, the layout record kept whole, the clamps (2026-11-10).
6. The camera at the display's rate (RV-1251 (b), notes/camera.md), RX83's findings (2026-11-10).
7. RX84's findings: the camera at the screen's refresh (a dividing cap's rate on a phone), every frame on a step, the
   pacer's refresh to it, resets, stalls, time away (2026-11-10).

## The phone profile (SMOKE1, static's, `.agents/bullet-diff/mobile-smoke.md`)

Phone emulation at 844 × 390, 4× CPU (a phone's main thread, roughly), the 3090 for the GPU (its figures indicative):
free play 60 fps, p95 6 ms, no long tasks, an 886 × 409 buffer (1.5 × 70 %); a 3v3 with five Wisps 56–59 fps, the main
thread 86 % busy (three.js, the six cars' prediction, particles): CPU-bound, so a lower resolution wouldn't help it;
~0.5 GB in all; the car answers the stick 54 ms after a touch. The load ends with one 1.8 s task (the glasshouse built,
three.js's first frame). Changed for the phone from it: the frame rate cap (a 120 Hz phone drew twice the frames), the
guard following heat, RV-1238 (sound never unlocked cost half the main thread and grew memory 1.8 MB/s). Not changed (the
profile doesn't show them mattering): the pixel ratio, the post pass, the glasshouse's detail, particles.

## Checks only a real phone can answer

From the research (`.agents/bullet-diff/mobile-research.md`) and the reviews; the user decides whether to run them.
- Multi-touch: the stick held with two buttons at once (an iPhone's and an Android's), the stick's edge at the screen's
  side (Safari's edge back-swipe, the notch: RV-1219).
- `pointercancel` on the home swipe, Control Centre and a call: every finger let go.
- The frame rate at 60, 120 (where the browser allows) and 30 (Low Power Mode), and heat over a 5-minute match at the
  pixel ratio's 1.5.
- The physics hash (`dd0f56c02d85870e`) in Safari and in Chrome on Android.
- Play vs Bots on an iPhone: onnxruntime-web within iOS's memory.
- Online play on iOS 26.4+ against the live servers (WebTransport, datagrams).
- Sound: unlocked by the first touch; the silent switch.
- The safe areas on a notched phone (the HUD, the menus, the controls).
- The home-screen app: full screen, landscape, its storage and its sign-in; the 7-day purge in Safari.
- Android's install: the manifest's icons, full screen and landscape from the home screen.
- A Bluetooth pad: Xbox and PlayStation glyphs in Safari.
- Turnstile's widget at a phone's size (the sign-up).
- Full screen on a finger's lift after the controls cancelled its touchstart (Chrome on Android: RV-1231).
