import { syncPreferenceToServer } from './preference-sync.svelte';
import {
  DEFAULT_THINKING_STYLE,
  isThinkingStyle,
  type ThinkingStyle,
} from '$lib/components/assistant/thinking-shader';

// The assistant's "Thinking…" spinner material (spec 027), same shape as sparkline-style.
const STORAGE_KEY = 'thinking-style';

function loadStyle(): ThinkingStyle {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (isThinkingStyle(raw)) return raw;
  } catch {}
  return DEFAULT_THINKING_STYLE;
}

function store(s: ThinkingStyle) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, s);
  } catch {}
}

let current = $state<ThinkingStyle>(loadStyle());

export const thinkingStyle = {
  get current() {
    return current;
  },
  set(s: ThinkingStyle) {
    current = s;
    store(s);
    syncPreferenceToServer('thinkingStyle', { style: s });
  },
  applyFromServer(data: { style: string }) {
    if (!isThinkingStyle(data.style)) return;
    current = data.style;
    store(data.style);
  },
};
