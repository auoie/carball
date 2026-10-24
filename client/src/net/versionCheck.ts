// The page's version against its servers' (RV-1030, RV-1063, RV-1078): a region whose server refused this page's version
// at its last ping is left out of a search (its mark, markVersion), the reload asked once and only of a page apart from
// its deployment (versionVerdict: a reload brings the page its servers take, RV-1021, RV-1066), never of the deployment's
// own page beside a server not updated yet, which a reload can't help. The menu's glue (main.ts), its modals handed in.
import { refusalText } from "./connection";
import { MATCHMAKER_TEXT } from "./matchmaker";
import { REFUSED_VERSION } from "./protocol";
import { markVersion, versionVerdict } from "./regions";

export interface VersionCheckDeps {
  /** Whether this page's version isn't its deployment's (pages.ts's pageOutdated) */
  readonly apart: () => Promise<boolean>;
  /** The reload's modal (its words: `reloadText`) */
  readonly reload: () => void;
  /** A modal saying `text` */
  readonly notice: (text: string) => void;
}

/** What a refusal on version says: a reload brings the page its servers take */
export const reloadText = (): string => refusalText(REFUSED_VERSION);

export class VersionCheck {
  /** The regions whose server refused this page's version at its last ping */
  readonly outdated = new Set<string>();
  private reloadShown = false;

  constructor(private readonly deps: VersionCheckDeps) {}

  /** A region's ping answered: a refusal on version marks it and checks the page's version (the reload, once, when it's
   *  apart), a pong clears it, no answer leaves it */
  answered(id: string, answer: { readonly ms: number; readonly server: string } | "outdated" | null): void {
    if (markVersion(this.outdated, id, answer)) void this.check(false);
  }

  /** A search left with only refused regions: what its refusal says. The page apart, the reload's words (its modal once);
   *  else those servers are being updated: the ticked regions', or the automatic pick's (RV-1068) */
  async refusal(automatic: boolean): Promise<string> {
    if ((await this.check(true)) === "reload") return reloadText();
    return automatic ? MATCHMAKER_TEXT.updating : MATCHMAKER_TEXT.behind;
  }

  /** A claim or a rejoin refused on version (the menu's notice): the reload's modal when the page is apart (its server
   *  updated since it loaded, RV-865), else that match's server is the one not updated yet (RV-1069) */
  async claimRefused(): Promise<void> {
    if (await this.deps.apart()) this.showReload();
    else this.deps.notice(MATCHMAKER_TEXT.matchUpdating);
  }

  private async check(outdatedOnly: boolean): Promise<"reload" | "updating" | null> {
    const verdict = versionVerdict(outdatedOnly, await this.deps.apart(), this.reloadShown);
    if (verdict.showReload) this.showReload();
    return verdict.refuse;
  }

  private showReload(): void {
    this.reloadShown = true;
    this.deps.reload();
  }
}
