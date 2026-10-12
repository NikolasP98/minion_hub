import { describe, test, expect } from 'vitest';
import {
  CONTEXT_MANIFESTS,
  MANIFEST_IDS,
  MANIFEST_THRESHOLDS,
  gateManifests,
  type RouteDecision,
} from './turn-router';

function decision(
  manifests: RouteDecision['manifests'],
  mode: RouteDecision['mode'] = 'chat',
): RouteDecision {
  return { mode, probabilities: { [mode]: 1 }, manifests, ms: 420, cost: 0.000022 };
}

describe('gateManifests', () => {
  test('a null decision loads everything — today’s full envelope', () => {
    expect([...gateManifests(null)].sort()).toEqual([...MANIFEST_IDS].sort());
  });

  test('shadow mode loads everything even with a usable decision', () => {
    const loaded = gateManifests(decision({ pages: 0, forms: 0, data: 0, brain: 0 }), 'shadow');
    expect([...loaded].sort()).toEqual([...MANIFEST_IDS].sort());
  });

  test('loads only the manifests at or above their own threshold', () => {
    const loaded = gateManifests(
      decision({ pages: 0.9, forms: 0.1, data: 0.55, brain: 0.2, changelog: 0.1 }),
      'enforce',
    );
    expect([...loaded].sort()).toEqual(['data', 'pages']);
  });

  test('"¿dónde configuro los horarios?" still gets the page list', () => {
    // Live 2026-10-12: pages=0.41. UI_TOOL_RULES (1) requires a "where do I…"
    // question to navigate, so this must not be gated out.
    const loaded = gateManifests(
      decision({ pages: 0.41, forms: 0.19, data: 0.15, brain: 0.37, changelog: 0.02 }, 'navigate'),
      'enforce',
    );
    expect(loaded.has('pages')).toBe(true);
  });

  test('the threshold is inclusive', () => {
    expect(gateManifests(decision({ data: MANIFEST_THRESHOLDS.data }), 'enforce').has('data')).toBe(
      true,
    );
    expect(
      gateManifests(decision({ data: MANIFEST_THRESHOLDS.data - 0.01 }), 'enforce').has('data'),
    ).toBe(false);
  });

  test('independent probabilities let two manifests load at once', () => {
    // The reason stage 2 is a noul per manifest and not a thresholded choice:
    // "add 4 boxes of X at 1200" needs the page list AND the form catalog, and
    // probabilities that sum to 1 cannot express "both apply".
    const loaded = gateManifests(decision({ pages: 0.8, forms: 0.75 }, 'record_action'), 'enforce');
    expect([...loaded].sort()).toEqual(['forms', 'pages']);
  });

  test('a manifest with no answer is not loaded', () => {
    expect(gateManifests(decision({ pages: 0.9 }), 'enforce').has('data')).toBe(false);
  });

  test('an out-of-range or non-numeric probability never loads a manifest', () => {
    const loaded = gateManifests(
      decision({ pages: Number.NaN, data: undefined as unknown as number }),
      'enforce',
    );
    expect([...loaded]).toEqual([]);
  });

  // The verification cases from the spec, with the probabilities the live
  // classifier produced for them (recorded 2026-10-12, model
  // typesafe/jev-1.13-20260917) — this asserts the GATE, not the model.
  test('"¿cuántas facturas pagó Ana este mes?" → data only, no page list', () => {
    const loaded = gateManifests(
      decision(
        { pages: 0.23, forms: 0.14, data: 0.92, brain: 0.5, changelog: 0.01 },
        'data_question',
      ),
      'enforce',
    );
    expect(loaded.has('pages')).toBe(false);
    expect(loaded.has('data')).toBe(true);
  });

  test('"llévame a inventario" → the page list loads', () => {
    const loaded = gateManifests(
      decision({ pages: 0.59, forms: 0.2, data: 0.12, brain: 0.29, changelog: 0.02 }, 'navigate'),
      'enforce',
    );
    expect(loaded.has('pages')).toBe(true);
  });
});

describe('CONTEXT_MANIFESTS', () => {
  test('every id is unique, thresholded in 0..1, and carries its question', () => {
    expect(CONTEXT_MANIFESTS.map((m) => m.id).sort()).toEqual([...MANIFEST_IDS].sort());
    expect(new Set(CONTEXT_MANIFESTS.map((m) => m.id)).size).toBe(CONTEXT_MANIFESTS.length);
    for (const manifest of CONTEXT_MANIFESTS) {
      expect(manifest.threshold).toBeGreaterThan(0);
      expect(manifest.threshold).toBeLessThanOrEqual(1);
      expect(manifest.question.length).toBeGreaterThan(20);
    }
  });
});
