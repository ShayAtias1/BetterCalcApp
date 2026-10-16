/**
 * Cloudflare Turnstile client for Supabase's CAPTCHA protection. Built but NOT active: with
 * CAPTCHA_ENABLED false no script is loaded and no token is requested, which is what Supabase expects
 * while its dashboard CAPTCHA setting is off. To activate, set both ends together: Supabase
 * Authentication → Bot and Abuse Protection → Turnstile (with the secret), `VITE_TURNSTILE_SITE_KEY`, and
 * this flag. Only the public site key ever reaches the browser.
 */
export const CAPTCHA_ENABLED = false;

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let scriptReady: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const win = window as TurnstileWindow;
  if (win.turnstile) return Promise.resolve(win.turnstile);
  scriptReady ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (win.turnstile ? resolve(win.turnstile) : reject(new Error('turnstile unavailable')));
    script.onerror = () => { scriptReady = null; reject(new Error('turnstile failed to load')); };
    document.head.appendChild(script);
  });
  return scriptReady;
}

/**
 * A single-use token for one sign-in request, or undefined when CAPTCHA is not active (or no site key is
 * configured). Rejects if the challenge cannot be completed, so a blocked challenge never silently sends
 * an unprotected request once protection is on.
 */
export async function getCaptchaToken(
  enabled = CAPTCHA_ENABLED,
  siteKey: string | undefined = import.meta.env?.VITE_TURNSTILE_SITE_KEY,
): Promise<string | undefined> {
  if (!enabled || !siteKey) return undefined;
  const turnstile = await loadTurnstile();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset-block-end:16px;inset-inline-end:16px;z-index:2147483647';
  document.body.appendChild(host);
  return new Promise<string>((resolve, reject) => {
    const id = turnstile.render(host, {
      sitekey: siteKey,
      callback: (token: string) => { turnstile.remove(id); host.remove(); resolve(token); },
      'error-callback': () => { turnstile.remove(id); host.remove(); reject(new Error('captcha failed')); },
    });
  });
}
