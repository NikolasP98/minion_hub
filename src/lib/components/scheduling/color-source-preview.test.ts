import { describe, expect, it } from 'vitest';
import { capPreview, previewValues, PREVIEW_CAP } from './color-source-preview';

const statusLabel = (s: string) => `S:${s}`;

describe('previewValues', () => {
  it('paints status from the fixed semantic ramp, never from domain colour', () => {
    const list = previewValues('status', { statusLabel });
    expect(list).toEqual([
      { name: 'S:pending', color: 'var(--color-warning-border)' },
      { name: 'S:accepted', color: 'var(--color-info-border)' },
      { name: 'S:completed', color: 'var(--color-success-border)' },
      { name: 'S:cancelled', color: 'var(--color-border-strong)' },
      { name: 'S:rejected', color: 'var(--color-danger-border)' },
      { name: 'S:no_show', color: 'var(--color-danger-border)' },
    ]);
  });

  it('maps each domain source to name + colour (service reads `title`)', () => {
    const data = {
      statusLabel,
      kinds: [{ name: 'Consulta', color: '#3b82f6' }],
      resources: [{ name: 'Chair 1', color: '#10b981' }],
      eventTypes: [{ title: 'Haircut', color: '#f59e0b' }],
      tags: [{ name: 'VIP', color: '#ec4899' }],
      categories: [{ name: 'Faciales', color: '#a855f7' }],
    };
    expect(previewValues('kind', data)).toEqual([{ name: 'Consulta', color: '#3b82f6' }]);
    expect(previewValues('staff', data)).toEqual([{ name: 'Chair 1', color: '#10b981' }]);
    expect(previewValues('service', data)).toEqual([{ name: 'Haircut', color: '#f59e0b' }]);
    expect(previewValues('tags', data)).toEqual([{ name: 'VIP', color: '#ec4899' }]);
    expect(previewValues('category', data)).toEqual([{ name: 'Faciales', color: '#a855f7' }]);
  });

  it('keeps a colourless value (neutral dot) but drops a nameless one', () => {
    expect(
      previewValues('tags', {
        statusLabel,
        tags: [{ name: 'Plain' }, { name: '  ', color: '#fff' }],
      }),
    ).toEqual([{ name: 'Plain', color: 'var(--color-border-strong)' }]);
  });

  it('previews nothing for `none` and for an absent source list', () => {
    expect(previewValues('none', { statusLabel })).toEqual([]);
    expect(previewValues('category', { statusLabel })).toEqual([]);
  });
});

describe('capPreview', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `t${i}`, color: '#000000' }));

  it('shows everything under the cap with nothing more', () => {
    expect(capPreview(many(3))).toEqual({ shown: many(3), more: 0 });
  });

  it('caps the list and counts the remainder', () => {
    const { shown, more } = capPreview(many(PREVIEW_CAP + 4));
    expect(shown).toHaveLength(PREVIEW_CAP);
    expect(more).toBe(4);
  });
});
