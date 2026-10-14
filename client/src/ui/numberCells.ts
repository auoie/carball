// The HUD's numbers ($NumbersWideFont: the clock, the scores, the boost number) set a cell a character at Dashboard
// Numbers Wide's advances (HT-12), whatever font stands in: its digits 0.796 em, but '1' 0.31 (proportional), ':' 0.14,
// '+' 0.442, the no-break space 0.486. Each glyph centred in its cell; the cells' size is the game's (CSS
// --numbers-size on the field, the user's finding 21). The fields are centred (TextField align center); the clock
// pads a trailing '1' with a no-break space (onTimeRemainingChanged: '1' + NBSP = a digit's advance), its letterSpacing
// between the characters but that last pair, so 1:10 to 1:11 doesn't move (the user's finding 22; a '1' elsewhere
// moves it, as the game's).

const NBSP = "\u00a0";
const ADVANCE: Readonly<Record<string, number>> = { "1": 0.31, ":": 0.14, "+": 0.442, [NBSP]: 0.486 };
const DIGIT_ADVANCE = 0.796;

/** A character's advance (em of the game's size) */
export function numberAdvance(c: string): number {
  return ADVANCE[c] ?? DIGIT_ADVANCE;
}

export interface NumberCell {
  readonly c: string;
  readonly advance: number;
  /** The field's letterSpacing after it */
  readonly spaced: boolean;
}

/** The text's cells: each character, its advance and whether the letterSpacing follows it (between characters; with
 *  `padOne`, the clock's: a trailing '1' padded with a no-break space, the spacing not on that last pair) */
export function numberCells(text: string, padOne = false): readonly NumberCell[] {
  const chars = Array.from(new Intl.Segmenter().segment(text), ({ segment }) => segment);
  const padded = padOne && chars.at(-1) === "1";
  if (padded) chars.push(NBSP);
  const spacedUpTo = chars.length - (padded ? 2 : 1);
  return chars.map((c, i) => ({ c, advance: numberAdvance(c), spaced: i < spacedUpTo }));
}

/** The cells' left edges in a centred field (em of the game's size; `spacing`: the letterSpacing in em) */
export function cellOffsets(cells: readonly NumberCell[], spacing: number): readonly number[] {
  const width = cells.reduce((sum, cell) => sum + cell.advance + (cell.spaced ? spacing : 0), 0);
  let x = -width / 2;
  return cells.map((cell) => {
    const at = x;
    x += cell.advance + (cell.spaced ? spacing : 0);
    return at;
  });
}

/** Sets a numbers field's text as cells (unchanged text: nothing done); `padOne`: the clock's padding */
export function setNumberText(el: HTMLElement, text: string, padOne = false): void {
  if (el.dataset["text"] === text) return;
  el.dataset["text"] = text;
  el.replaceChildren(
    ...numberCells(text, padOne).map(({ c, advance, spaced }) => {
      const cell = document.createElement("span");
      cell.className = spaced ? "num-cell spaced" : "num-cell";
      cell.style.setProperty("--advance", String(advance));
      cell.textContent = c;
      return cell;
    }),
  );
}
