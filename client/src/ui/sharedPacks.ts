// Custom Training's shared packs in the main menu (ours; notes/custom-training.md §9): Browse (a search, newest or the
// most downloaded, a page at a time: each pack's name, creator, shots and downloads, with Play, Save and Report), Enter
// Code (a share code found and shown the same way), and on My Packs the player's own shared ones (their codes, Copy
// Code and Delete; one an admin hid says so). Every text the service sends is set as text, never markup.
import { AccountError, type AccountsApi, type SharedPack } from "../account/api";
import type { PackListing } from "../training/packs";
import { shareCode, sharedListing } from "../training/shared";
import { accountErrorText } from "./accountPages";

/** The shared packs' words (ours) */
export const SHARE_TEXT = {
  tabs: { mine: "My Packs", browse: "Browse", code: "Enter Code" },
  search: "Search packs",
  find: "Search",
  newest: "Newest",
  downloads: "Most Downloaded",
  more: "More",
  play: "Play",
  save: "Save",
  saved: "Saved",
  report: "Report",
  reported: "Reported",
  loading: "Loading…",
  none: "No packs found.",
  codePlaceholder: "XXXX-XXXX-XXXX-XXXX",
  findCode: "Find",
  badCode: "A share code is 16 letters and digits: XXXX-XXXX-XXXX-XXXX.",
  meta: (p: SharedPack): string =>
    `by ${p.creator} · ${String(p.shots)} shot${p.shots === 1 ? "" : "s"} · ${String(p.downloads)} download${p.downloads === 1 ? "" : "s"}`,
  mineHeading: "My Shared Packs",
  signInToShare: "Sign in to share packs and see the ones you've shared.",
  noneShared: "You haven't shared a pack yet: Share in the Training Editor.",
  copyCode: "Copy Code",
  copied: "Copied",
  delete: "Delete",
  deleteTitle: "DELETE SHARED PACK",
  deleteBody: (name: string): string => `Take “${name}” off the shared packs? Its code stops working. Your own copy stays.`,
  hidden: (reason: string): string => `Hidden by a moderator: ${reason}`,
  reportTitle: "REPORT PACK",
  reportBody: (name: string): string => `Report “${name}” to the moderators?`,
  reportedTitle: "REPORTED",
  reportedBody: "Thanks: the moderators will look at it.",
  signInToReport: "Sign in to report packs.",
  notSavedTitle: "NOT SAVED",
  notSaved: "Not saved: the browser's storage is full or blocked.",
  copyTitle: "SHARE CODE",
  notPlayableTitle: "NOT PLAYABLE",
  notPlayable: "This pack can't be played: it couldn't be read, or isn't a training pack.",
  sharingOff: "Packs can't be shared on this page.",
} as const;

/** What the shared packs' views need from the page */
export interface SharedPacksActions {
  readonly api: Pick<AccountsApi, "browsePacks" | "pack" | "myPacks" | "deletePack" | "reportPack">;
  /** Whether the player is signed in now */
  readonly signedIn: () => boolean;
  /** Play this pack (a shared one's listing: read through the API) */
  readonly play: (listing: PackListing) => void;
  /** Save this shared pack among the player's own: null, else what went wrong in words */
  readonly save: (code: string) => Promise<string | null>;
  /** A confirm (its yes), and a notice */
  readonly ask: (title: string, body: string, yes: () => void) => void;
  readonly notice: (title: string, body: string) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
};

const button = (text: string, onClick: () => void, className = ""): HTMLButtonElement => {
  const b = el("button", `main-menu-button ${className}`.trim(), text);
  b.addEventListener("click", onClick);
  return b;
};

/** A refusal in words: the service's, else the error's own */
export function sharedErrorText(e: unknown): string {
  return e instanceof AccountError ? accountErrorText(e.code, e.seconds, e.detail) : accountErrorText("server");
}

/** The share code copied, else shown to copy by hand */
async function copyCode(code: string, notice: SharedPacksActions["notice"]): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    notice(SHARE_TEXT.copyTitle, code);
    return false;
  }
}

export class SharedPacksPage {
  readonly #actions: SharedPacksActions;
  #sort: "new" | "downloads" = "new";
  #next: string | null = null;
  #search = "";
  /** (the browse's list as read: the last read's own, a newer one replacing it) */
  #reads = 0;

  readonly browse: HTMLDivElement;
  readonly code: HTMLDivElement;
  readonly mine: HTMLDivElement;
  readonly #searchInput: HTMLInputElement;
  readonly #sortButtons: Readonly<Record<"new" | "downloads", HTMLButtonElement>>;
  readonly #browseState: HTMLDivElement;
  readonly #browseList: HTMLDivElement;
  readonly #more: HTMLButtonElement;
  readonly #codeInput: HTMLInputElement;
  readonly #codeState: HTMLDivElement;
  readonly #codeResult: HTMLDivElement;
  readonly #mineState: HTMLDivElement;
  readonly #mineList: HTMLDivElement;

  constructor(actions: SharedPacksActions) {
    this.#actions = actions;
    // (Browse: the search and its order a row, the state line, the packs, More)
    this.browse = el("div", "main-menu-shared main-menu-shared-browse");
    this.#searchInput = el("input", "main-menu-input main-menu-shared-search");
    this.#searchInput.type = "search";
    this.#searchInput.placeholder = SHARE_TEXT.search;
    this.#searchInput.maxLength = 30;
    this.#searchInput.setAttribute("aria-label", SHARE_TEXT.search);
    this.#searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      this.#find();
    });
    const find = button(SHARE_TEXT.find, () => {
      this.#find();
    });
    const sorts = el("div", "main-menu-shared-sorts");
    sorts.setAttribute("role", "radiogroup");
    this.#sortButtons = {
      new: button(SHARE_TEXT.newest, () => {
        this.#setSort("new");
      }),
      downloads: button(SHARE_TEXT.downloads, () => {
        this.#setSort("downloads");
      }),
    };
    for (const b of Object.values(this.#sortButtons)) b.setAttribute("role", "radio");
    sorts.append(this.#sortButtons.new, this.#sortButtons.downloads);
    const searchRow = el("div", "main-menu-shared-search-row");
    searchRow.append(this.#searchInput, find);
    this.#browseState = el("div", "main-menu-shared-state");
    this.#browseState.setAttribute("role", "status");
    this.#browseList = el("div", "main-menu-training main-menu-shared-list");
    this.#more = button(SHARE_TEXT.more, () => {
      void this.#read(false);
    });
    this.#more.hidden = true;
    this.browse.append(searchRow, sorts, this.#browseState, this.#browseList, this.#more);
    this.#markSort();
    // (Enter Code: the code and Find a row, the state line, the pack found)
    this.code = el("div", "main-menu-shared main-menu-shared-code");
    this.#codeInput = el("input", "main-menu-input main-menu-shared-code-input");
    this.#codeInput.placeholder = SHARE_TEXT.codePlaceholder;
    this.#codeInput.maxLength = 24;
    this.#codeInput.autocomplete = "off";
    this.#codeInput.spellcheck = false;
    this.#codeInput.setAttribute("aria-label", SHARE_TEXT.tabs.code);
    this.#codeInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      void this.#findCode();
    });
    const codeRow = el("div", "main-menu-shared-search-row");
    codeRow.append(
      this.#codeInput,
      button(SHARE_TEXT.findCode, () => {
        void this.#findCode();
      }),
    );
    this.#codeState = el("div", "main-menu-shared-state");
    this.#codeState.setAttribute("role", "status");
    this.#codeState.hidden = true;
    this.#codeResult = el("div", "main-menu-training main-menu-shared-list");
    this.code.append(codeRow, this.#codeState, this.#codeResult);
    // (My Packs' shared section: a heading, its state line, the player's own shared packs)
    this.mine = el("div", "main-menu-shared main-menu-shared-mine");
    this.#mineState = el("div", "main-menu-shared-state");
    this.#mineState.setAttribute("role", "status");
    this.#mineList = el("div", "main-menu-shared-list");
    this.mine.append(el("div", "main-menu-shared-heading", SHARE_TEXT.mineHeading), this.#mineState, this.#mineList);
  }

  /** Browse shown: its first page read (again, each time it's shown) */
  showBrowse(): void {
    void this.#read(true);
  }

  /** Enter Code shown: the field to type in */
  showCode(): void {
    this.#codeInput.focus({ preventScroll: true });
  }

  #find(): void {
    this.#search = this.#searchInput.value.trim();
    void this.#read(true);
  }

  #setSort(sort: "new" | "downloads"): void {
    this.#sort = sort;
    this.#markSort();
    void this.#read(true);
  }

  #markSort(): void {
    for (const [sort, b] of Object.entries(this.#sortButtons)) b.setAttribute("aria-checked", String(sort === this.#sort));
  }

  /** A page read: the first (`fresh`: the list replaced) or the next (added) */
  async #read(fresh: boolean): Promise<void> {
    const read = ++this.#reads;
    const cursor = fresh ? null : this.#next;
    if (fresh) {
      this.#browseList.replaceChildren();
      this.#more.hidden = true;
    }
    this.#browseState.hidden = false;
    this.#browseState.textContent = SHARE_TEXT.loading;
    try {
      const page = await this.#actions.api.browsePacks(this.#search, this.#sort, cursor);
      if (read !== this.#reads) return;
      this.#next = page.next;
      this.#browseList.append(...page.packs.map((p) => this.#row(p)));
      this.#more.hidden = page.next === null;
      const empty = this.#browseList.childElementCount === 0;
      this.#browseState.hidden = !empty;
      this.#browseState.textContent = empty ? SHARE_TEXT.none : "";
    } catch (e) {
      if (read !== this.#reads) return;
      this.#browseState.textContent = sharedErrorText(e);
    }
  }

  async #findCode(): Promise<void> {
    const code = shareCode(this.#codeInput.value);
    this.#codeResult.replaceChildren();
    this.#codeState.hidden = false;
    if (code === null) {
      this.#codeState.textContent = SHARE_TEXT.badCode;
      return;
    }
    this.#codeInput.value = code;
    this.#codeState.textContent = SHARE_TEXT.loading;
    try {
      const { pack } = await this.#actions.api.pack(code);
      this.#codeState.hidden = true;
      this.#codeResult.append(this.#row(pack));
    } catch (e) {
      this.#codeState.textContent = sharedErrorText(e);
    }
  }

  /** A shared pack's row: its name, creator, shots and downloads; Play, Save, Report */
  #row(p: SharedPack): HTMLElement {
    const row = el("div", "main-menu-pack-row main-menu-shared-row");
    row.dataset["code"] = p.code;
    const about = el("div", "main-menu-pack main-menu-shared-about");
    about.append(el("span", "main-menu-pack-name", p.name), el("span", "main-menu-pack-about", SHARE_TEXT.meta(p)));
    const play = button(SHARE_TEXT.play, () => {
      this.#actions.play(sharedListing(p));
    });
    play.dataset["action"] = "play";
    const save = button(SHARE_TEXT.save, () => {
      save.disabled = true;
      void this.#actions.save(p.code).then((problem) => {
        if (problem === null) {
          save.textContent = SHARE_TEXT.saved;
          return;
        }
        save.disabled = false;
        this.#actions.notice(SHARE_TEXT.notSavedTitle, problem);
      });
    });
    save.dataset["action"] = "save";
    const report = button(SHARE_TEXT.report, () => {
      if (!this.#actions.signedIn()) {
        this.#actions.notice(SHARE_TEXT.reportTitle, SHARE_TEXT.signInToReport);
        return;
      }
      this.#actions.ask(SHARE_TEXT.reportTitle, SHARE_TEXT.reportBody(p.name), () => {
        void this.#actions.api.reportPack(p.code).then(
          () => {
            report.textContent = SHARE_TEXT.reported;
            report.disabled = true;
            this.#actions.notice(SHARE_TEXT.reportedTitle, SHARE_TEXT.reportedBody);
          },
          (e: unknown) => {
            this.#actions.notice(SHARE_TEXT.reportTitle, sharedErrorText(e));
          },
        );
      });
    });
    report.dataset["action"] = "report";
    row.append(about, play, save, report);
    return row;
  }

  /** My Packs' shared section read again: signed out, a line to sign in; else the player's own shared packs */
  async refreshMine(): Promise<void> {
    this.#mineList.replaceChildren();
    this.#mineState.hidden = false;
    if (!this.#actions.signedIn()) {
      this.#mineState.textContent = SHARE_TEXT.signInToShare;
      return;
    }
    this.#mineState.textContent = SHARE_TEXT.loading;
    try {
      const { packs } = await this.#actions.api.myPacks();
      this.#mineState.hidden = packs.length > 0;
      this.#mineState.textContent = packs.length > 0 ? "" : SHARE_TEXT.noneShared;
      this.#mineList.replaceChildren(...packs.map((p) => this.#ownRow(p)));
    } catch (e) {
      this.#mineState.textContent = sharedErrorText(e);
    }
  }

  /** One of the player's shared packs: its name, code and downloads (a hide's reason under them); Copy Code, Delete */
  #ownRow(p: SharedPack): HTMLElement {
    const row = el("div", "main-menu-pack-row main-menu-shared-row");
    row.dataset["code"] = p.code;
    const about = el("div", "main-menu-pack main-menu-shared-about");
    about.append(el("span", "main-menu-pack-name", p.name), el("span", "main-menu-pack-about", `${p.code} · ${String(p.downloads)} downloads`));
    if (p.hidden) about.append(el("span", "main-menu-shared-hidden", SHARE_TEXT.hidden(p.hiddenReason)));
    const copy = button(SHARE_TEXT.copyCode, () => {
      void copyCode(p.code, this.#actions.notice).then((copied) => {
        if (copied) copy.textContent = SHARE_TEXT.copied;
      });
    });
    copy.dataset["action"] = "copy";
    const remove = button(SHARE_TEXT.delete, () => {
      this.#actions.ask(SHARE_TEXT.deleteTitle, SHARE_TEXT.deleteBody(p.name), () => {
        void this.#actions.api.deletePack(p.code).then(
          () => {
            row.remove();
            if (this.#mineList.childElementCount === 0) {
              this.#mineState.hidden = false;
              this.#mineState.textContent = SHARE_TEXT.noneShared;
            }
          },
          (e: unknown) => {
            this.#actions.notice(SHARE_TEXT.deleteTitle, sharedErrorText(e));
          },
        );
      });
    });
    remove.dataset["action"] = "delete";
    row.append(about, copy, remove);
    return row;
  }
}
