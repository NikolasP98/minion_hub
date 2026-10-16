import { mount } from 'svelte';
import '../../../src/app.css';
import Recipes from './Recipes.svelte';
import contract from '@minion-stack/design-tokens/contract.json';
import { applyTheme } from '$lib/themes/runtime';
import { PRESETS } from '$lib/themes/presets';

/** @typedef {import('$lib/themes/presets').ThemePreset['id']} ContractThemeId */
const params = new URLSearchParams(location.search);
/**
 * @param {string} id
 * @returns {id is ContractThemeId}
 */
function isThemeId(id) {
  return Object.hasOwn(contract.themes, id);
}
/** @param {string} id */
function theme(id) {
  if (!isThemeId(id)) throw new Error('Unknown fixture theme');
  const value = contract.themes[id];
  // Same runtime adapter as the app; the two Site-only contract themes still
  // exercise the shared palette even though they are absent from Hub's picker,
  // so they borrow a same-mode preset's legacy roles under their own id.
  const preset = PRESETS.find((entry) => entry.id === id) ?? {
    ...(PRESETS.find((entry) => entry.mode === value.mode) ?? PRESETS[0]),
    id,
  };
  applyTheme(preset, value.colors.accent);
}
Object.assign(window, {
  __designFixture: {
    theme,
    themes: Object.keys(contract.themes),
    contractVersion: contract.contractVersion,
  },
});
theme(params.get('theme') ?? 'github-light');
const decoration = params.get('decoration');
if (decoration) document.documentElement.dataset.theme = decoration;
document.documentElement.lang = params.get('lang') ?? 'en';
const target = document.getElementById('app');
if (!target) throw new Error('Fixture mount target missing');
mount(Recipes, { target });
