// DEP-02 (12-02 Task 2) baseline evidence.
//
// TODO(handoff): this file is a partial regression guard, not the migration.
// `@inlang/paraglide-sveltekit` (`npm view @inlang/paraglide-sveltekit deprecated`
// -> "use the paraglide-js package directly with v2 or above ... the sveltekit
// adapter is not needed anymore") is consumed by `createI18n()` /
// `.handle()` / `.reroute()` in src/lib/i18n.ts, src/hooks.server.ts:548,
// src/hooks.ts, and src/lib/canonical-path.ts, plus the link-translation
// preprocessor pulled out of the paraglide vite plugin in svelte.config.js.
// None of those files are owned by 12-02 (files_modified: vite.config.ts,
// package.json, bun.lock, this test only) and a real swap to paraglide-js v2's
// own SvelteKit integration cannot be made without editing them, so the
// adapter itself was NOT removed here — see 12-02-SUMMARY.md and
// proposals/2026-09-09-hub-paraglide-adapter-migration-followup.md for the
// exact child-plan scope. This test only locks in what remains true
// regardless of which adapter eventually renders the page: message identity
// and the runtime's per-call locale-selection contract.
import { describe, it, expect } from 'vitest';
import * as m from '../../src/lib/paraglide/messages.js';
import { availableLanguageTags, sourceLanguageTag } from '../../src/lib/paraglide/runtime.js';

describe('paraglide locale parity (baseline, pre-migration)', () => {
  it('keeps EN/ES as the exact configured locale set', () => {
    expect(sourceLanguageTag).toBe('en');
    expect(availableLanguageTags).toEqual(['en', 'es']);
  });

  it('resolves a real message identifier to distinct EN/ES text via the per-call override', () => {
    // a11y0_alerts is a real generated message key (src/lib/paraglide/messages/{en,es}.js);
    // this is a roundtrip through the actual compiled output, not a fixture string.
    expect(m.a11y0_alerts({}, { languageTag: 'en' })).toBe('Alerts');
    expect(m.a11y0_alerts({}, { languageTag: 'es' })).toBe('Alertas');
  });

  it('does not bleed locale across concurrent requests when callers pass an explicit languageTag', async () => {
    // The supported per-call form (options.languageTag) never touches the module-level
    // `languageTag()` closure, so it is safe under concurrent async interleaving.
    const requests = Array.from({ length: 20 }, (_, i) => {
      const tag = i % 2 === 0 ? ('en' as const) : ('es' as const);
      return new Promise<{ tag: 'en' | 'es'; text: string }>((resolve) => {
        setTimeout(() => resolve({ tag, text: m.a11y0_alerts({}, { languageTag: tag }) }), Math.random() * 5);
      });
    });
    const results = await Promise.all(requests);
    for (const r of results) {
      expect(r.text).toBe(r.tag === 'en' ? 'Alerts' : 'Alertas');
    }
  });

  it('documents (does not fix) the ambient setLanguageTag race the real migration must close', async () => {
    // This is the exact hazard the task's done-criteria calls "locale bleed": the
    // deprecated adapter's `i18n.handle()` calls `setLanguageTag()` against a shared
    // module-level variable, then SvelteKit's own resolve() (page render) runs later,
    // possibly after other awaited work from a concurrent request. Reproduced directly
    // against the compiled runtime, with no app/hooks code involved, so it holds
    // regardless of real request timing.
    const { setLanguageTag, languageTag } = await import('../../src/lib/paraglide/runtime.js');
    async function ambientRequest(tag: 'en' | 'es') {
      setLanguageTag(tag);
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      return { tag, text: m.a11y0_alerts(), ambientAtRead: languageTag() };
    }
    const [a, b] = await Promise.all([ambientRequest('en'), ambientRequest('es')]);
    const bled = [a, b].some((r) => r.text !== (r.tag === 'en' ? 'Alerts' : 'Alertas'));
    // Known-defect characterization, not a target state: flip this expectation only
    // once the adapter migration gives each request its own locale context.
    expect(bled).toBe(true);
  });
});
