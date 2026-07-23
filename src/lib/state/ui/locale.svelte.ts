import {
  setLanguageTag,
  availableLanguageTags,
  type AvailableLanguageTag,
} from '$lib/paraglide/runtime';
import { localizePath } from '$lib/canonical-path';
import { syncPreferenceToServerImmediately } from './preference-sync.svelte';

const STORAGE_KEY = 'minion-hub-locale';
const DEFAULT_LOCALE: AvailableLanguageTag = 'en';

function loadLocale(): AvailableLanguageTag {
  if (typeof localStorage === 'undefined') return DEFAULT_LOCALE;
  // URL wins: with prefixDefaultLanguage 'always' the locale is part of the
  // address (/en/..., /es/...) — the store follows it, never the reverse.
  if (typeof location !== 'undefined') {
    const seg = location.pathname.split('/')[1];
    if ((availableLanguageTags as readonly string[]).includes(seg)) {
      return seg as AvailableLanguageTag;
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (availableLanguageTags as readonly string[]).includes(raw)) {
      return raw as AvailableLanguageTag;
    }
  } catch {}
  return DEFAULT_LOCALE;
}

/** Re-enter the current page under the new locale prefix (URL = source of truth). */
function navigateToLocale(tag: AvailableLanguageTag) {
  if (typeof location === 'undefined') return;
  const target = localizePath(location.pathname, tag) + location.search + location.hash;
  if (location.pathname + location.search + location.hash !== target) {
    // This must be a document navigation, not an in-memory SvelteKit route
    // update. The localized pathname is the durable locale source; replacing
    // the document guarantees refresh/SSR cannot restore the previous prefix.
    location.replace(target);
  }
}

function saveLocale(tag: AvailableLanguageTag) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, tag);
}

let current = $state<AvailableLanguageTag>(loadLocale());

// Initialize paraglide runtime with the stored locale
setLanguageTag(() => current);

export const locale = {
  get current() {
    return current;
  },
  get available() {
    return availableLanguageTags as readonly AvailableLanguageTag[];
  },

  set(tag: AvailableLanguageTag) {
    current = tag;
    saveLocale(tag);
    syncPreferenceToServerImmediately('locale', { tag });
    navigateToLocale(tag);
  },

  toggle() {
    const next = current === 'en' ? 'es' : 'en';
    current = next;
    saveLocale(next);
    syncPreferenceToServerImmediately('locale', { tag: next });
    navigateToLocale(next);
  },

  applyFromServer(data: { tag: string }) {
    if (!(availableLanguageTags as readonly string[]).includes(data.tag)) return;
    // URL is the source of truth: when the address already carries a locale
    // segment, the server preference only persists for future sessions —
    // it must not yank the user off the language they explicitly opened.
    if (typeof location !== 'undefined') {
      const seg = location.pathname.split('/')[1];
      if ((availableLanguageTags as readonly string[]).includes(seg)) {
        saveLocale(data.tag as AvailableLanguageTag);
        return;
      }
    }
    current = data.tag as AvailableLanguageTag;
    saveLocale(current);
  },
};
