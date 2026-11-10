# Mobile web

Phones and tablets play every mode (free play, Play vs Bots, custom training, online matches in the same queues as
everyone else): the user's request of 2026-11-10. Landscape only. This note is the design; the code is
`client/src/input/touch.ts` (the controls), `client/src/input/mapping.ts` (their reading) and
`client/src/input/devices.ts` (the stick on a pad).

## Platform

- **WebTransport on iPhones:** Safari 26.4 (March 2026) shipped it on iOS and macOS (WebKit's "WebKit Features for
  Safari 26.4"; MDN marks the API Baseline 2026). Every iPhone browser is WebKit, so an iPhone on iOS 26.4 or later
  plays online; an older one plays the offline modes (clean point 2: a notice, as the Firefox one, and no Find Match).
  WebKit's fallback over HTTP/2 when QUIC is blocked doesn't reach our servers, which speak QUIC alone.
- **Full screen:** a touch device asks for it at its first touch whatever the Display Mode setting (`DisplayMode`, its
  `fullscreen || touchDevice()`), and turns to landscape once in it where the browser allows (Android's
  `screen.orientation.lock`). iPhone Safari has no element full screen: clean point 2 adds a web app manifest, so
  Add to Home Screen opens the game full screen.
- **Sound:** unlocked by a touch's end or a click too (iOS Safari doesn't start audio from a finger landing).
- **GPU:** a touch device gets the weak-GPU defaults (an iPhone's WebGL says only "Apple GPU"); the pixel ratio is
  capped at 2 as before.

## Controls (`client/src/input/touch.ts`)

Shown in play on a touch device (its main pointer coarse, or a touch since the page opened), hidden under every menu
and the training editor's own page. A real pad's button or stick hides them until the next touch: a Bluetooth pad on a
phone plays and works the menus as on a desktop.

- **The stick:** a floating stick on the left half, centred where the thumb lands, 56 px of travel. It is a pad's left
  stick: `InputDevices` puts it on a virtual pad's axes 0 and 1 (merged with a real pad's, the tilt further from centre
  winning each axis), so steer, pitch, yaw, the controller deadzone, the dodge's direction and deadzone and air pitch
  safety are the controller's own. A flip is a pad's: jump twice with the stick tilted.
- **Throttle (ours; easy to change: `stickThrottle` in mapping.ts):** the stick's tilt past the deadzone drives
  forward, except in its bottom quarter (within 45 degrees of straight down), which reverses. Steering at full lock
  still drives. In the air the same stick pitches and yaws, as on a pad.
- **Buttons (actions, not pad buttons):** Jump (also the replay skip, as the pad's A), Boost, Slide (powerslide and air
  roll at once, as the default pad's X and the game's own), Ball cam. They press the actions directly: the default pad
  binds both Reverse and Air roll to LT, so pressing pad buttons would cross them. A tap shorter than a frame counts,
  as a key's tap; the jump's latch keeps it for a tick.
- **The top row:** Pause (the pause menu, as the pad's Start), then the mode's own: free play's Reset; training's
  Prev, Reset (the retry) and Next; online's Scores (held).
- **Multi-touch:** every finger its own pointer, captured where it lands.
- **Layout:** the stick's zone is the left half; Jump in the right thumb's corner, Boost left of it, Slide over it,
  Ball cam between; the top row top left (the scoreboard top centre stays clear). Everything is inside the safe area
  (`env(safe-area-inset-*)`, with `viewport-fit=cover`). In touch play the HUD's boost ring and flip lamp move to the
  stage's top right, out from under the buttons.

## The page

- **Portrait:** a touch device held upright gets "Turn your phone sideways to play" over everything (the stylesheet's
  `(orientation: portrait) and (pointer: coarse)`).
- **No browser gestures in play:** the viewport can't zoom (`maximum-scale=1`; Safari's pinch stopped by its gesture
  events), `touch-action: manipulation` everywhere (no double-tap zoom) and `none` on the game and the controls, no
  pull to refresh (`overscroll-behavior: none`), no long-press callout or tap flash, no text selection outside text
  fields. The game's height is the visible one (`100dvh`).

## Clean points

1. Play by touch: the controls, the page's gestures, the rotate prompt, full screen, sound, the GPU defaults
   (2026-11-10).
2. Menus by touch: target sizes, nothing hover-only, the settings and the account pages (sign-in and Turnstile at
   phone size), the training editor by touch (its free camera, keyboard-only, hidden), the WebTransport notice, the
   web app manifest.
3. Polish from what 1 and 2 show, and the checks only a real phone can answer.
