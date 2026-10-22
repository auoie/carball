// The account's page in the main menu (notes/accounts.md §5, §6): signed out, Sign In (Google or Steam: online play needs
// an account, the offline modes don't); after a provider's first sign-in, the sign-up (the name other players see, and
// Turnstile's check); signed in, the account (its name and rename, the sign-ins it has, sign out, sign out everywhere,
// delete). Our own words: the game signs in with its platforms' accounts, with no page of this kind.
import { type Account, type AccountsApi, AccountError, type ApiError, type Provider, type Signup, ratingText, signInUrl } from "../account/api";
import type { TurnstileWidget } from "../account/turnstile";
import { PLAYLISTS } from "../game/matchmaking";

export const ACCOUNT_TEXT = {
  entrySignedOut: "Sign In",
  signInTitle: "Sign In",
  signInBody: "Online play needs an account. Free Play, Custom Training and Play vs Bots don't.",
  findMatchNeedsAccount: "Sign in to play online.",
  google: "Sign in with Google",
  steam: "Sign in with Steam",
  privacy: "Privacy",
  back: "Back",
  signUpTitle: "Create Account",
  signUpBody: (provider: Provider): string => `Signed in with ${PROVIDER_NAMES[provider]}. Choose the name other players see.`,
  name: "Name",
  create: "Create Account",
  cancel: "Cancel",
  checking: "Waiting for the check…",
  checkNotLoaded: "The check didn't load. Create Account tries again.",
  accountTitle: "Account",
  signedInWith: (providers: readonly Provider[]): string => `Signed in with ${providers.map((p) => PROVIDER_NAMES[p]).join(" and ")}`,
  ratings: "Ratings",
  provisionalNote: "? while provisional: a few more matches settle it",
  rename: "Rename",
  save: "Save",
  signOut: "Sign Out",
  signOutEverywhere: "Sign Out Everywhere",
  deleteAccount: "Delete Account",
  deleteTitle: "DELETE ACCOUNT",
  deleteBody: "Your account, its sign-ins and its ratings go at once. This sign-in can't make a new account for 30 days. Delete it?",
  signedOutEverywhere: "Signed out on every device.",
  sessionEnded: "Your sign-in has ended. Sign in again to play online.",
  unavailableTitle: "ONLINE PLAY",
  serversUnreachable: "The game's servers can't be reached right now. Try again later.",
} as const;

const PROVIDER_NAMES: Readonly<Record<Provider, string>> = { google: "Google", steam: "Steam" };

/** A display name's longest (the API's 32 bytes: the field counts characters, the API says if a name is too long) */
const NAME_MAX_BYTES = 32;

/** A refusal in our words */
export function accountErrorText(code: ApiError): string {
  switch (code) {
    case "name-empty":
      return "Enter a name.";
    case "name-too-long":
      return "That name is too long.";
    case "turnstile":
      return "The check didn't pass. Try again.";
    case "taken":
      return "This sign-in already has an account. Sign in again.";
    case "banned":
      return "This sign-in is banned.";
    case "blocked":
      return "This sign-in deleted an account less than 30 days ago.";
    case "no-signup":
      return "The sign-up ran out of time. Sign in again.";
    case "signed-out":
      return "You're signed out. Sign in again.";
    case "busy":
      return "Too many tries. Wait a while and try again.";
    case "unavailable":
      return "Accounts aren't reachable right now. Try again later.";
    case "server":
      return "Something went wrong. Try again.";
  }
}

/** A sign-in's return in our words (`/?signin=…`): its modal's title and line */
export function signInNotice(reason: "failed" | "cancelled" | "busy" | "banned" | "blocked" | "unavailable", until: string | null): readonly [string, string] {
  switch (reason) {
    case "cancelled":
      return ["SIGN IN", "Sign-in cancelled."];
    case "busy":
      return ["SIGN IN", "Too many sign-ins from this network. Try again later."];
    case "banned":
      return ["BANNED", until === null ? "This account is banned." : `This account is banned until ${until}.`];
    case "blocked":
      return ["SIGN IN", until === null ? accountErrorText("blocked") : `This sign-in deleted an account. It can make a new one from ${until}.`];
    case "unavailable":
      return ["SIGN IN", "Signing in with that isn't available right now."];
    case "failed":
      return ["SIGN IN", "Sign-in failed. Try again."];
  }
}

export interface AccountPagesActions {
  /** The page's modal: a question (Yes runs `yes`) */
  readonly ask: (title: string, body: string, yes: () => void) => void;
  /** The account changed (signed in, renamed, signed out): the menu's entry follows */
  readonly changed: (account: Account | null) => void;
  /** Leave the page (Back, Cancel) */
  readonly back: () => void;
  /** Go to a provider's sign-in (a page load) */
  readonly go: (url: string) => void;
  /** Turnstile's widget in `container` (src/account/turnstile.ts) */
  readonly turnstile: (container: HTMLElement, siteKey: string, token: (value: string | null) => void) => Promise<TurnstileWidget>;
}

/** The account page's three forms, drawn into the menu's account column */
export class AccountPages {
  readonly #body: HTMLElement;
  readonly #api: AccountsApi;
  readonly #actions: AccountPagesActions;
  #widget: TurnstileWidget | null = null;

  constructor(body: HTMLElement, api: AccountsApi, actions: AccountPagesActions) {
    this.#body = body;
    this.#api = api;
    this.#actions = actions;
  }

  /** Signed out: the providers (`note`: why it's shown, e.g. Find Match) */
  showSignIn(note: string | null = null): void {
    const T = ACCOUNT_TEXT;
    const google = this.#button(T.google, () => {
      this.#actions.go(signInUrl("google"));
    });
    const steam = this.#button(T.steam, () => {
      this.#actions.go(signInUrl("steam"));
    });
    this.#draw(T.signInTitle, [
      this.#line(note ?? T.signInBody, note ? "account-note" : "account-line"),
      google,
      steam,
      this.#privacy(),
      this.#backButton(T.back),
    ]);
    google.focus({ preventScroll: true });
  }

  /** A provider's first sign-in: the name (the suggestion to start from) and the check, then Create Account */
  showSignUp(signup: Signup): void {
    const T = ACCOUNT_TEXT;
    const name = this.#input(signup.suggestion, signup.nameMaxBytes);
    const widget = document.createElement("div");
    widget.className = "account-turnstile";
    const status = this.#line("", "account-status");
    let token = signup.turnstileSiteKey === "" ? "" : null;
    // (Turnstile's script not loaded (offline, an ad blocker): said so, and Create Account loads it again, RX29C)
    let notLoaded = false;
    const check = (): void => {
      notLoaded = false;
      this.#actions
        .turnstile(widget, signup.turnstileSiteKey, (value) => {
          token = value;
          if (value !== null && status.textContent === T.checking) status.textContent = "";
        })
        .then((rendered) => {
          // (the page left meanwhile: its widget gone with it)
          if (widget.isConnected) this.#widget = rendered;
          else rendered.remove();
        })
        .catch(() => {
          notLoaded = true;
          status.textContent = T.checkNotLoaded;
        });
    };
    const create = this.#button(T.create, () => {
      if (token === null) {
        status.textContent = T.checking;
        if (notLoaded) check();
        return;
      }
      create.disabled = true;
      this.#api
        .createAccount(name.value, token)
        .then((account) => {
          this.#clearWidget();
          this.#actions.changed(account);
          this.showAccount(account);
        })
        .catch((e: unknown) => {
          create.disabled = false;
          status.textContent = accountErrorText(e instanceof AccountError ? e.code : "server");
          // (the check's token spent by the refused try: a new check before the next, RX29C)
          if (this.#widget) {
            token = null;
            this.#widget.reset();
          }
        });
    });
    create.classList.add("main-menu-find");
    this.#draw(T.signUpTitle, [this.#line(T.signUpBody(signup.provider)), this.#label(T.name, name), widget, status, create, this.#backButton(T.cancel)]);
    if (signup.turnstileSiteKey !== "") check();
    name.focus({ preventScroll: true });
  }

  /** Signed in: the account */
  showAccount(account: Account): void {
    const T = ACCOUNT_TEXT;
    const status = this.#line("", "account-status");
    const fail = (e: unknown): void => {
      status.textContent = accountErrorText(e instanceof AccountError ? e.code : "server");
      // (the session gone: the sign-in's page, not the account's controls, RX29C)
      if (e instanceof AccountError && e.code === "signed-out") {
        this.#actions.changed(null);
        this.showSignIn(ACCOUNT_TEXT.sessionEnded);
      }
    };
    const name = this.#input(account.name, NAME_MAX_BYTES); // (as the sign-up's: RX29C)
    const save = this.#button(T.save, () => {
      this.#api
        .rename(name.value)
        .then((renamed) => {
          this.#actions.changed(renamed);
          this.showAccount(renamed);
        })
        .catch(fail);
    });
    const signOut = this.#button(T.signOut, () => {
      this.#api
        .signOut()
        .then(() => {
          this.#actions.changed(null);
          this.showSignIn();
        })
        .catch(fail);
    });
    const everywhere = this.#button(T.signOutEverywhere, () => {
      this.#api
        .signOutEverywhere()
        .then(() => {
          this.#actions.changed(null);
          this.showSignIn(T.signedOutEverywhere);
        })
        .catch(fail);
    });
    const remove = this.#button(T.deleteAccount, () => {
      this.#actions.ask(T.deleteTitle, T.deleteBody, () => {
        this.#api
          .deleteAccount()
          .then(() => {
            this.#actions.changed(null);
            this.showSignIn();
          })
          .catch(fail);
      });
    });
    remove.classList.add("account-danger");
    const rename = document.createElement("div");
    rename.className = "account-rename";
    rename.append(this.#label(T.rename, name), save);
    const ratings = this.#line(
      PLAYLISTS.map((p) => {
        const r = account.ratings.find((x) => x.playlist === p.teamSize);
        return `${p.name} ${r ? ratingText(r) : "–"}`;
      }).join("   "),
      "account-ratings",
    );
    // (what "?" means, shown under the ratings when one has it: a tooltip a pad or a touch screen never shows, RV-709)
    const provisional = account.ratings.some((r) => r.provisional) ? [this.#line(T.provisionalNote, "account-note")] : [];
    this.#draw(T.accountTitle, [
      this.#line(account.name, "account-name"),
      this.#line(T.signedInWith(account.providers)),
      ratings,
      ...provisional,
      rename,
      status,
      signOut,
      everywhere,
      remove,
      this.#privacy(),
      this.#backButton(T.back),
    ]);
    signOut.focus({ preventScroll: true });
  }

  /** Left (the menu closed or moved on): Turnstile's widget gone */
  left(): void {
    this.#clearWidget();
  }

  #clearWidget(): void {
    this.#widget?.remove();
    this.#widget = null;
  }

  #draw(title: string, parts: readonly HTMLElement[]): void {
    this.#clearWidget();
    const heading = document.createElement("div");
    heading.className = "main-menu-heading";
    heading.textContent = title;
    this.#body.replaceChildren(heading, ...parts);
  }

  #button(label: string, click: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "main-menu-button";
    b.textContent = label;
    b.addEventListener("click", click);
    return b;
  }

  #backButton(label: string): HTMLButtonElement {
    return this.#button(label, () => {
      this.#clearWidget();
      this.#actions.back();
    });
  }

  #line(text: string, className = "account-line"): HTMLDivElement {
    const d = document.createElement("div");
    d.className = className;
    d.textContent = text;
    return d;
  }

  #input(value: string, maxBytes: number): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "account-input";
    input.value = value;
    input.maxLength = maxBytes; // (characters, the API counts bytes: it says if a name is too long)
    input.autocomplete = "off";
    input.spellcheck = false;
    return input;
  }

  #label(text: string, input: HTMLInputElement): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = "account-field";
    const span = document.createElement("span");
    span.textContent = text;
    label.append(span, input);
    return label;
  }

  #privacy(): HTMLAnchorElement {
    const a = document.createElement("a");
    a.className = "account-privacy";
    a.href = "/privacy.html";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = ACCOUNT_TEXT.privacy;
    return a;
  }
}
