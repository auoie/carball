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
  touchend). iPhone Safari has no element full screen: the web app manifest (`public/manifest.json`: 192 and 512 px
  icons and a maskable one, rendered from favicon.svg, as Chrome's install wants: RV-1228) and a hint on an iPhone ("Tap
  Share, then Add to Home Screen") make the home-screen app the way, dismissed once for good. An iPad's Safari has
  element full screen (16.4 on): its hint only where that's missing (RV-1226).
- **Storage:** Safari erases a site's storage after 7 days without a visit (not a home-screen app's, which starts with
  storage of its own, so it signs in again; the hint says both). Settings fall back to their defaults when storage is
  empty, so nothing breaks; local training packs are what's lost.
- **The screen kept on** in play on a touch device (`navigator.wakeLock`), let go under a menu, taken again when the page
  comes back.
- **Sound:** unlocked by a touch's end or a click too (iOS Safari doesn't start audio from a finger landing).
- **GPU:** a touch device gets the weak-GPU defaults (an iPhone's WebGL says only "Apple GPU") and a pixel ratio of 1.5
  at most (2 elsewhere): a phone holds 60 fps (30 in Low Power Mode).
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
  kept, so an update never wipes it. Reset Button Layout puts every button back.
- **Buttons (actions, not pad buttons):** Jump (also the replay skip, as the pad's A), Boost, Slide (powerslide and air
  roll at once, as the default keyboard's right mouse button and the Legacy pad's X do; the default pad's X is powerslide
  alone, its air roll on LT: RV-1218), Ball cam. They press the actions directly: the default pad
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
