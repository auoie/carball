// Cloudflare Turnstile on the sign-up page (notes/accounts.md §4, AC-16): its script loaded once, only when a sign-up
// needs it (the page's CSP lets challenges.cloudflare.com's script and frame in: RV-639); the widget rendered explicitly,
// its token handed to the sign-up. The API checks the token, its hostname and its action ("signup").

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      readonly sitekey: string;
      readonly action: string;
      readonly theme: "dark";
      readonly callback: (token: string) => void;
      readonly "expired-callback": () => void;
      readonly "error-callback": () => void;
    },
  ): string;
  remove(widget: string): void;
  reset(widget: string): void;
}

/** A rendered widget: reset it (a new check: its token was spent by a refused sign-up), or remove it */
export interface TurnstileWidget {
  readonly reset: () => void;
  readonly remove: () => void;
}

let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.addEventListener("load", () => {
      const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new Error("turnstile: no API"));
    });
    script.addEventListener("error", () => {
      loading = null; // (tried again next time)
      reject(new Error("turnstile: the script didn't load"));
    });
    document.head.append(script);
  });
  return loading;
}

/** The widget in `container` for this site key: `token` with each check passed, null when one expires or fails */
export async function turnstileWidget(container: HTMLElement, siteKey: string, token: (value: string | null) => void): Promise<TurnstileWidget> {
  const api = await load();
  const widget = api.render(container, {
    sitekey: siteKey,
    action: "signup",
    theme: "dark",
    callback: token,
    "expired-callback": () => {
      token(null);
    },
    "error-callback": () => {
      token(null);
    },
  });
  return {
    reset: () => {
      api.reset(widget);
    },
    remove: () => {
      api.remove(widget);
    },
  };
}
