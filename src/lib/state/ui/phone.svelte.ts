import { MediaQuery } from 'svelte/reactivity';

/** Phone = narrow viewport, or a landscape phone (coarse pointer, short height). */
export const PHONE_QUERY = '(max-width: 767.98px), ((pointer: coarse) and (max-height: 500px))';
export const phone = new MediaQuery(PHONE_QUERY);

/** Mirrors `phone.current` so a server load can pick the phone default view before first paint. */
export const PHONE_COOKIE = 'hub_phone';

export function syncPhoneCookie(isPhone: boolean): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = isPhone
      ? `${PHONE_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`
      : `${PHONE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    /* cookies blocked: the hint is best-effort */
  }
}
