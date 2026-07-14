import { render } from 'svelte/server';
import { describe, expect, test } from 'vitest';
import PrimitiveConformanceFixture from './_test/PrimitiveConformanceFixture.svelte';

describe('Hub primitive accessibility contracts', () => {
  test('generates unique field IDs and names switches, tabs, panels, and dialogs', () => {
    const { body } = render(PrimitiveConformanceFixture);
    const selectIds = [...body.matchAll(/<select[^>]+id="([^"]+)"/g)].map((match) => match[1]);

    expect(selectIds).toHaveLength(2);
    expect(new Set(selectIds).size).toBe(2);
    for (const id of selectIds) expect(body).toContain(`for="${id}"`);
    expect(body).toMatch(/role="switch"[^>]+aria-label="Enable audit"/);
    expect(body).toContain('role="tablist"');
    expect(body).toContain('aria-label="Fixture sections"');
    expect(body).toContain('aria-controls="fixture-tabs-panel-details"');
    expect(body).toContain('id="fixture-tabs-panel-details"');
    expect(body).toMatch(/<dialog[^>]+aria-label="Fixture dialog"/);
  });
});
