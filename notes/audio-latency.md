# Audio latency (2026-10-22: "the audio feels delayed")

What stands between a game event and its sound being heard, measured in headless Chrome on the user's Linux machine
(offline renders through our own chain, and live AudioContexts):

| Stage | Before | Now | Ours? |
|---|---|---|---|
| Detection | the frame whose physics ticks had the event: the latest tick's state (not the interpolated render's), engine contacts for impacts, no debounce | the same | ours, nothing to remove |
| The frame's order | sounds started after the frame was rendered (the Render stat's ms, a few on a desktop) | before the render (free play and online) | ours, removed |
| Scheduling | `currentTime + 0.005` (UI cues + 0.01) | `currentTime`: the next block rendered | ours, removed (5–10 ms) |
| The master limiter | DynamicsCompressorNode: a fixed 6 ms look-ahead (288 samples at 48 kHz, measured) | kept: it holds the loud hits' peaks and stops a pile-up clipping; without it they'd be louder by several dB | ours, kept (6 ms) |
| Attacks | 1–4 ms to −40 dBFS | the same | ours, nothing to remove |
| Engine and boost loops | `setTargetAtTime` τ: engine 0.08 s (90% of a throttle change in 184 ms), pitch 0.06 s, boost on 0.03 s (69 ms), off 0.09 s (207 ms) | engine and pitch 0.03 s (69 ms), boost on 0.01 s (23 ms), off 0.04 s (92 ms); the supersonic wind's 0.25 s kept | ours, shortened |
| The browser's base latency | `latencyHint: "interactive"`: 10.7 ms (512 frames) | the same | the browser's (`0` gives 2.7 ms here, at the risk of crackles on a slower machine) |
| The output latency | 208–216 ms, whatever the hint | the same | the OS's and the device's: the default output is Bluetooth headphones (A2DP, AAC), whose own buffering is most of it; wired output removes it |

A sound's start, from the call to its first audible sample (−40 dBFS), offline: 12.4–12.9 ms before, 7.4–7.9 ms now
(the limiter's 6 ms and the attack's 1.5–2 ms left), plus the render's time no longer in front of it.

The stat graphs' Performance levels (Interface → Stat Graphs) show two rows of ours under the game's: **Audio Base** (the browser's
processing) and **Audio Out** (the OS's and the device's output), read from the AudioContext each frame.

**Known edges (RX39, not changed):**
- With no margin, a frame that reads `currentTime` while the browser is mid-callback starts its sounds up to one render
  quantum (128 frames, 2.7 ms) late, their 1–3 ms attack skipped: an oscillator starts at zero phase (no step), a noise
  burst at its peak. Not heard so far; if a click ever is, schedule one quantum ahead (128 / sampleRate).
- Other browsers, not measured: Firefox may report `baseLatency` 0; Safari has no `outputLatency`, so its Audio Out row
  never appears; Firefox computes a filter's coefficients once per 128-frame block, so with the engine's τ 0.03 s its
  filter moves about 8.5% of the way per block (3.3% before), likely not heard.
