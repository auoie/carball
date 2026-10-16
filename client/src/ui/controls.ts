// Our own form controls for the menus (the user's request, 2026-10-16: custom, in the menus' look, the same in every
// browser): a checkbox (its whole row the control), a list's cycler (its value between two chevrons, stepped in place,
// never a popup, for the mouse too) and a slider (its track, fill and thumb). Each one focusable element with its ARIA
// role, state and label, keyboard operable; the pad's menu navigation (src/ui/padNav.ts) steps a cycler or a slider by
// a `control-step` event and clicks a checkbox.

/** The event the pad steps a cycler or a slider by: `detail` its steps (negative: back); cancelled when the value moved */
export const CONTROL_STEP = "control-step";

/** Steps `el` (a cycler or a slider) by `steps`; whether its value moved */
export function stepControl(el: HTMLElement, steps: number): boolean {
  return !el.dispatchEvent(new CustomEvent(CONTROL_STEP, { detail: steps, cancelable: true }));
}

let labels = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The control's data attributes (what the settings and the tests find it by) and its title */
interface Common {
  readonly label: string;
  readonly data?: Readonly<Record<string, string>>;
  readonly title?: string;
}

function common(control: HTMLElement, o: Common): void {
  control.tabIndex = 0;
  Object.assign(control.dataset, o.data);
  if (o.title !== undefined) control.title = o.title;
}

/** A row of `className` with its label (the pad's highlight bar on the row) and `control` labelled by it */
function labelled(className: string, label: string, control: HTMLElement, ...rest: HTMLElement[]): HTMLDivElement {
  const row = element("div", className);
  row.dataset["padRow"] = "";
  const text = element("span", "control-label", label);
  text.id = `control-label-${String(++labels)}`;
  control.setAttribute("aria-labelledby", text.id);
  row.append(text, control, ...rest);
  return row;
}

export interface CheckboxOptions extends Common {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** A checkbox: its row (the box and the label) one control, toggled by a click anywhere on it, Space or Enter */
export function checkbox(o: CheckboxOptions): HTMLDivElement {
  const row = element("div", "option control-check");
  row.setAttribute("role", "checkbox");
  row.dataset["padRow"] = "";
  common(row, o);
  const box = element("span", "control-box");
  box.setAttribute("aria-hidden", "true");
  row.append(box, element("span", "control-label", o.label));
  let checked = o.checked;
  row.setAttribute("aria-checked", String(checked));
  const toggle = (): void => {
    checked = !checked;
    row.setAttribute("aria-checked", String(checked));
    o.onChange(checked);
  };
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    toggle();
  });
  return row;
}

export interface CyclerOptions<V extends string> extends Common {
  /** Its values and their text, in order */
  readonly options: readonly (readonly [value: V, text: string])[];
  readonly value: V;
  readonly onChange: (value: V) => void;
}

/** A list's cycler, in a row with its label: its value between two chevrons, stepped in place (wrapping) by a click on
 *  either half, the arrow keys (Home, End), or the pad. The control has `data-value` its value */
export function cycler<V extends string>(o: CyclerOptions<V>): HTMLDivElement {
  return labelled("option control-row", o.label, cyclerControl(o));
}

/** The cycler alone (a table's cell: labelled by its row's header) */
export function cyclerControl<V extends string>(o: CyclerOptions<V>): HTMLDivElement {
  const control = element("div", "control-cycle");
  control.setAttribute("role", "spinbutton");
  common(control, o);
  // (its name: in a row, the row's label takes over: aria-labelledby)
  control.setAttribute("aria-label", o.label);
  const value = element("span", "control-value");
  const chevron = (side: string): HTMLSpanElement => {
    const c = element("span", `control-chevron ${side}`);
    c.setAttribute("aria-hidden", "true");
    return c;
  };
  control.append(chevron("control-prev"), value, chevron("control-next"));
  const n = o.options.length;
  control.setAttribute("aria-valuemin", "0");
  control.setAttribute("aria-valuemax", String(Math.max(0, n - 1)));
  let index = Math.max(0, o.options.findIndex(([v]) => v === o.value));
  const show = (): void => {
    const [v, text] = o.options[index] ?? ["", ""];
    control.dataset["value"] = v;
    control.setAttribute("aria-valuenow", String(index));
    control.setAttribute("aria-valuetext", text);
    value.textContent = text;
  };
  show();
  const choose = (next: number): boolean => {
    if (n < 2 || next === index) return false;
    index = next;
    show();
    const chosen = o.options[index];
    if (chosen) o.onChange(chosen[0]);
    return true;
  };
  const step = (by: number): boolean => choose((((index + by) % n) + n) % n);
  control.addEventListener("click", (e) => {
    const r = control.getBoundingClientRect();
    step(e.clientX < r.left + r.width / 2 ? -1 : 1);
  });
  control.addEventListener("keydown", (e) => {
    const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (by !== undefined) step(by);
    else if (e.key === "Home") choose(0);
    else if (e.key === "End") choose(n - 1);
    else return;
    e.preventDefault();
  });
  control.addEventListener(CONTROL_STEP, (e) => {
    if (step(Math.sign((e as CustomEvent<number>).detail))) e.preventDefault();
  });
  return control;
}

export interface SliderOptions extends Common {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** Its value as shown (beside it, and its aria-valuetext) */
  readonly format: (value: number) => string;
  readonly onChange: (value: number) => void;
}

/** `v` on a slider's grid: clamped to [min, max], at a whole number of steps from min, without a float's tail */
export function onGrid(v: number, min: number, max: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const clamped = Math.min(max, Math.max(min, v));
  return Number((Math.round((clamped - min) / step) * step + min).toFixed(decimals + 2));
}

/** The thumb's width (CSS px: style.css's .control-thumb), its travel the track less this */
const THUMB = 16;

/** A slider, in a row with its label and its value shown: dragged or clicked along, the arrow keys (Page: a tenth of
 *  its range; Home, End), the wheel while it has the focus, or the pad. Its value on the step's grid; shown as it moves,
 *  applied when let go (a key, a wheel notch or a pad step: at once). The control's aria-valuenow its value */
export function slider(o: SliderOptions): HTMLDivElement {
  const control = element("div", "control-slider");
  control.setAttribute("role", "slider");
  common(control, o);
  const track = element("span", "control-track");
  track.append(element("span", "control-fill"));
  const thumb = element("span", "control-thumb");
  control.append(track, thumb);
  control.setAttribute("aria-valuemin", String(o.min));
  control.setAttribute("aria-valuemax", String(o.max));
  const output = element("output", "control-output");
  const snap = (v: number): number => onGrid(v, o.min, o.max, o.step);
  let value = snap(o.value);
  const show = (): void => {
    const text = o.format(value);
    control.style.setProperty("--at", String(o.max > o.min ? (value - o.min) / (o.max - o.min) : 0));
    control.setAttribute("aria-valuenow", String(value));
    control.setAttribute("aria-valuetext", text);
    output.textContent = text;
  };
  show();
  /** To `v` (snapped), applied or only shown; whether it moved */
  const set = (v: number, apply: boolean): boolean => {
    const next = snap(v);
    if (next === value) return false;
    value = next;
    show();
    if (apply) o.onChange(value);
    return true;
  };
  // The mouse: pressed on it, the value under the pointer; dragged, it follows; let go, applied
  const at = (clientX: number): number => {
    const r = control.getBoundingClientRect();
    const f = (clientX - r.left - THUMB / 2) / Math.max(1, r.width - THUMB);
    return o.min + Math.min(1, Math.max(0, f)) * (o.max - o.min);
  };
  let dragFrom: number | null = null;
  control.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    control.focus({ preventScroll: true });
    control.setPointerCapture(e.pointerId);
    dragFrom = value;
    set(at(e.clientX), false);
  });
  control.addEventListener("pointermove", (e) => {
    if (dragFrom !== null) set(at(e.clientX), false);
  });
  const release = (): void => {
    if (dragFrom === null) return;
    const moved = value !== dragFrom;
    dragFrom = null;
    if (moved) o.onChange(value);
  };
  control.addEventListener("pointerup", release);
  control.addEventListener("pointercancel", release);
  control.addEventListener("keydown", (e) => {
    const page = Math.max(o.step, (o.max - o.min) / 10);
    const by = { ArrowLeft: -o.step, ArrowDown: -o.step, ArrowRight: o.step, ArrowUp: o.step, PageDown: -page, PageUp: page }[e.key];
    if (by !== undefined) set(value + by, true);
    else if (e.key === "Home") set(o.min, true);
    else if (e.key === "End") set(o.max, true);
    else return;
    e.preventDefault();
  });
  // (the wheel only while it has the focus: a page scrolled past it isn't caught)
  control.addEventListener(
    "wheel",
    (e) => {
      if (document.activeElement !== control || e.deltaY === 0) return;
      e.preventDefault();
      set(value + (e.deltaY < 0 ? o.step : -o.step), true);
    },
    { passive: false },
  );
  control.addEventListener(CONTROL_STEP, (e) => {
    if (set(value + (e as CustomEvent<number>).detail * o.step, true)) e.preventDefault();
  });
  return labelled("slider", o.label, control, output);
}
