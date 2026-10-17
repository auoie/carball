// The {key} token in the HUD's prompts (notes/hud-menus.md HT-3): keyboard keys as words, the pad's buttons and the
// mouse's as inline icons (our own: a pad button's round badge or rounded tab, a mouse with the button lit), about 1.5
// times the line's height. The line round it is upper-cased by its CSS.
import { type GamepadInput, type KeyboardInput, type PadStyle, currentPadStyle, inputGlyph } from "../input/bindings";

export type KeyGlyph =
  | { readonly kind: "word"; readonly text: string }
  | { readonly kind: "mouse"; readonly button: number }
  | { readonly kind: "pad"; readonly button: number; readonly text: string; readonly style: PadStyle }
  /** A stick's direction (ours: its badge, L or R, with an arrow; `text` its name, for the title and the tests) */
  | { readonly kind: "stick"; readonly stick: "L" | "R"; readonly direction: "left" | "right" | "up" | "down"; readonly text: string };

/** The arrows a stick's badge points with */
const STICK_ARROWS = { left: "◂", right: "▸", up: "▴", down: "▾" } as const;

/** The face buttons' letters (Xbox layout, the game's PC fallback glyphs) */
const PAD_FACE = ["A", "B", "X", "Y"];

/** An input as the prompt draws it (a pad button in the connected pad's set: PlayStation's ✕ ○ □ △, HT-3) */
export function keyGlyph(input: KeyboardInput | GamepadInput | null, style: PadStyle = currentPadStyle()): KeyGlyph {
  if (input?.kind === "mouse") return { kind: "mouse", button: input.button };
  // (the standard layout's sticks: a badge, not the axis's long name, RV-512)
  if (input?.kind === "padAxis" && input.axis >= 0 && input.axis <= 3) {
    const horizontal = input.axis % 2 === 0;
    const direction = horizontal ? (input.sign > 0 ? "right" : "left") : input.sign > 0 ? "down" : "up";
    return { kind: "stick", stick: input.axis < 2 ? "L" : "R", direction, text: inputGlyph(input, style) };
  }
  if (input?.kind === "padButton") {
    const text = style === "xbox" ? (PAD_FACE[input.button] ?? inputGlyph(input, style)) : inputGlyph(input, style);
    return { kind: "pad", button: input.button, text, style };
  }
  return { kind: "word", text: inputGlyph(input, style) };
}

/** A mouse outline with the button lit (0 left, 1 middle, 2 right; 3 and 4 the side buttons) */
function mouseSvg(button: number): string {
  const lit = (b: number): string => (b === button ? "currentColor" : "none");
  return (
    `<svg viewBox="0 0 16 24" aria-hidden="true">` +
    `<rect x="1.5" y="1.5" width="13" height="21" rx="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
    `<path d="M2.2 9.5 H8 V2.2 A6 6 0 0 0 2.2 8 Z" fill="${lit(0)}"/>` +
    `<path d="M13.8 9.5 H8 V2.2 A6 6 0 0 1 13.8 8 Z" fill="${lit(2)}"/>` +
    `<rect x="6.6" y="4" width="2.8" height="5" rx="1.4" fill="${lit(1)}" stroke="currentColor" stroke-width="0.8"/>` +
    (button >= 3 ? `<rect x="0" y="${button === 3 ? 12 : 16}" width="3" height="3" fill="currentColor"/>` : "") +
    `</svg>`
  );
}

/** A key's glyph as an element (a word, a pad button's badge, a mouse with its button lit) */
export function glyphElement(key: KeyGlyph): HTMLSpanElement {
  const glyph = document.createElement("span");
  glyph.className = `key-glyph key-${key.kind}`;
  if (key.kind === "mouse") {
    glyph.innerHTML = mouseSvg(key.button);
    glyph.title = `Mouse ${String(key.button + 1)}`;
  } else if (key.kind === "stick") {
    glyph.textContent = key.stick;
    const arrow = document.createElement("span");
    arrow.className = "key-stick-arrow";
    arrow.textContent = STICK_ARROWS[key.direction];
    glyph.append(arrow);
    glyph.title = key.text;
    glyph.dataset["direction"] = key.direction;
  } else {
    glyph.textContent = key.text;
    if (key.kind === "pad") {
      glyph.dataset["button"] = String(key.button);
      glyph.dataset["style"] = key.style;
    }
  }
  return glyph;
}

/** "Press {key} to {action}" into `el`, the key as its glyph */
export function renderPrompt(el: HTMLElement, key: KeyGlyph, action: string): void {
  const text = `Press|${key.kind}|${key.kind === "mouse" ? String(key.button) : key.text}|${key.kind === "pad" ? key.style : ""}|${action}`;
  if (el.dataset["prompt"] === text) return;
  el.dataset["prompt"] = text;
  el.replaceChildren(document.createTextNode("Press "), glyphElement(key), document.createTextNode(` to ${action}`));
}

/** No prompt */
export function clearPrompt(el: HTMLElement): void {
  if (el.dataset["prompt"] === "") return;
  el.dataset["prompt"] = "";
  el.replaceChildren();
}
