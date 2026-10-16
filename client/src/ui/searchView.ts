// The search's views (notes/matchmaking.md MM-4..8): the Searching panel over the main menu (its title, the summary, the
// message log, Cancel Search), and elsewhere the 26 px banner across the top (the summary, Cancel Search). Back closes the
// panel and the search goes on under the banner; both go when the search ends.
import { OWN_SEARCH_TEXT, SEARCH_TEXT, type SearchViewState } from "../game/matchmaking";

const SUMMARY: Record<SearchViewState["status"], string> = {
  connecting: SEARCH_TEXT.connecting,
  searching: SEARCH_TEXT.searching,
  joining: SEARCH_TEXT.joining,
  failed: SEARCH_TEXT.failed,
  ended: OWN_SEARCH_TEXT.ended,
};

/** What shows: the panel while it's open over the menu, else the banner (never both: RV-360); neither without a search */
export function searchViews(state: SearchViewState | null, panelOpen: boolean): { readonly panel: boolean; readonly banner: boolean } {
  return { panel: state !== null && panelOpen, banner: state !== null && !panelOpen };
}

export class SearchView {
  readonly #panel: HTMLDivElement;
  readonly #panelSummary: HTMLDivElement;
  readonly #log: HTMLDivElement;
  readonly #banner: HTMLDivElement;
  readonly #bannerSummary: HTMLDivElement;
  #panelOpen = false;
  #shown = "";

  constructor(host: HTMLElement, cancel: () => void) {
    this.#panel = document.createElement("div");
    this.#panel.id = "search-panel";
    this.#panel.className = "search-panel";
    const title = document.createElement("div");
    title.className = "search-title";
    title.textContent = SEARCH_TEXT.title;
    this.#panelSummary = document.createElement("div");
    this.#panelSummary.className = "search-summary";
    this.#log = document.createElement("div");
    this.#log.className = "search-log";
    const cancelButton = (): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "search-cancel";
      b.textContent = SEARCH_TEXT.cancel;
      b.addEventListener("click", cancel);
      return b;
    };
    this.#panel.append(title, this.#panelSummary, this.#log, cancelButton());
    this.#panel.hidden = true;
    this.#banner = document.createElement("div");
    this.#banner.id = "search-banner";
    this.#banner.className = "search-banner";
    this.#bannerSummary = document.createElement("div");
    this.#bannerSummary.className = "search-summary";
    this.#banner.append(cancelButton(), this.#bannerSummary);
    this.#banner.hidden = true;
    host.append(this.#panel, this.#banner);
  }

  get panelOpen(): boolean {
    return this.#panelOpen && !this.#panel.hidden;
  }

  /** The panel over the menu (Find Match opens it) */
  openPanel(): void {
    this.#panelOpen = true;
  }

  /** Back: the panel closes, the search goes on under the banner */
  closePanel(): void {
    this.#panelOpen = false;
  }

  update(state: SearchViewState | null): void {
    if (state === null) this.#panelOpen = false;
    const views = searchViews(state, this.#panelOpen);
    this.#panel.hidden = !views.panel;
    this.#banner.hidden = !views.banner;
    if (state === null) return;
    const shown = JSON.stringify(state);
    if (shown === this.#shown) return;
    this.#shown = shown;
    for (const summary of [this.#panelSummary, this.#bannerSummary]) {
      summary.textContent = SUMMARY[state.status];
      summary.dataset["status"] = state.status;
    }
    this.#log.replaceChildren(
      ...state.lines.map((line) => {
        const l = document.createElement("div");
        l.className = `search-line ${line.kind}`;
        l.textContent = line.text;
        return l;
      }),
    );
  }
}
