import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { render } from 'svelte/server';
import { describe, expect, test } from 'vitest';
import PrimitiveConformanceFixture from './_test/PrimitiveConformanceFixture.svelte';
import { selectValueFromChange } from './Select.svelte';

const componentSource = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}.svelte`, import.meta.url)), 'utf8');

describe('Hub primitive accessibility contracts', () => {
  test('keeps compatibility APIs on canonical primitive and dialog semantics', () => {
    const { body } = render(PrimitiveConformanceFixture);
    const selectIds = [...body.matchAll(/<select[^>]+id="([^"]+)"/g)].map((match) => match[1]);

    expect(selectIds).toHaveLength(2);
    expect(new Set(selectIds).size).toBe(2);
    for (const id of selectIds) expect(body).toContain(`for="${id}"`);
    expect(body).toMatch(/role="switch"[^>]+aria-label="Enable audit"/);
    expect(body).toContain('data-part="toggle"');
    expect(body).toContain('data-part="select"');
    const field = body.match(/<div class="([^"]*)" data-part="field">/)?.[1] ?? '';
    const select = body.match(/<select[^>]+class="([^"]*)"[^>]+data-part="select"/)?.[1] ?? '';
    expect(field).toContain('fixture-field');
    expect(field).not.toContain('fixture-legacy-control');
    expect(field).not.toContain('fixture-explicit-control');
    expect(select).toContain('fixture-legacy-control');
    expect(select).toContain('fixture-explicit-control');
    expect(body).toContain('data-part="spinner"');
    expect(body).toContain('data-part="skeleton"');
    expect(body).toContain('data-component="dialog"');
    expect(body).toContain('Audits every change');
    expect(body).toContain('value="2"');
    expect(body).toContain('!h-[var(--control-height-xs)]');
    expect(body).toContain('role="tablist"');
    expect(body).toContain('aria-label="Fixture sections"');
    expect(body).toContain('aria-controls="fixture-tabs-panel-details"');
    expect(body).toContain('id="fixture-tabs-panel-details"');
    expect(body).toMatch(/<dialog[^>]+aria-labelledby="[^"]+-title"/);
    expect(body).toMatch(/<h2 id="[^"]+-title"[^>]*>Fixture dialog<\/h2>/);
  });

  test('delegates primitive behavior instead of maintaining parallel native controls', () => {
    for (const name of ['Select', 'Toggle', 'Spinner', 'Skeleton']) {
      const source = componentSource(name);
      expect(source).toMatch(/from '@minion-stack\/ui'/);
      expect(source).not.toContain('<style>');
    }

    expect(componentSource('Select')).not.toMatch(/<select[\s>]/);
    expect(componentSource('Toggle')).not.toMatch(/<button[\s>]/);
    expect(componentSource('Modal')).toMatch(/from '\.\/foundations\/Dialog\.svelte'/);
    expect(componentSource('Modal')).not.toMatch(/<dialog[\s>]/);
    expect(componentSource('Modal')).not.toContain('<style>');
  });

  test('preserves legacy numeric option values at the Select event boundary', () => {
    const numericEvent = {
      currentTarget: {
        value: '4',
        selectedOptions: { item: () => ({ __value: 4 }) },
      },
    } as unknown as Event;
    const stringEvent = {
      currentTarget: {
        value: 'four',
        selectedOptions: { item: () => null },
      },
    } as unknown as Event;

    expect(selectValueFromChange(numericEvent)).toBe(4);
    expect(selectValueFromChange(stringEvent)).toBe('four');
  });
});
