import { setLanguageTag, availableLanguageTags, type AvailableLanguageTag } from '$lib/paraglide/runtime';

const STORAGE_KEY = 'minion-hub-locale';
const DEFAULT_LOCALE: AvailableLanguageTag = 'en';

function loadLocale(): AvailableLanguageTag {
  if (typeof localStorage === 'undefined') return DEFAULT_LOCALE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && (availableLanguageTags as readonly string[]).includes(raw)) {
      return raw as AvailableLanguageTag;
    }
  } catch {}
  return DEFAULT_LOCALE;
}

function saveLocale(tag: AvailableLanguageTag) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, tag);
}

let current = $state<AvailableLanguageTag>(loadLocale());

// Initialize paraglide runtime with the stored locale
setLanguageTag(() => current);

export const locale = {
  get current() { return current; },
  get available() { return availableLanguageTags as readonly AvailableLanguageTag[]; },

  set(tag: AvailableLanguageTag) {
    current = tag;
    saveLocale(tag);
  },

  toggle() {
    const next = current === 'en' ? 'es' : 'en';
    current = next;
    saveLocale(next);
  },
};
