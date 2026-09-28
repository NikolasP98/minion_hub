import { describe, expect, it } from 'vitest';
import { columnPresentationSchema, DEFAULT_COLUMN_PRESENTATION } from './column-presentation';

describe('column presentation contract', () => {
  it('accepts the strict versioned numeric presentation', () => {
    expect(columnPresentationSchema.parse(DEFAULT_COLUMN_PRESENTATION)).toEqual(
      DEFAULT_COLUMN_PRESENTATION,
    );
  });

  it.each([-1, 7, 1.5])('rejects invalid decimal precision %s', (decimals) => {
    expect(
      columnPresentationSchema.safeParse({
        ...DEFAULT_COLUMN_PRESENTATION,
        number: { ...DEFAULT_COLUMN_PRESENTATION.number, decimals },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown keys and malformed secondary identities', () => {
    expect(
      columnPresentationSchema.safeParse({ ...DEFAULT_COLUMN_PRESENTATION, extra: true }).success,
    ).toBe(false);
    expect(
      columnPresentationSchema.safeParse({
        ...DEFAULT_COLUMN_PRESENTATION,
        secondary: {
          propertyId: 'not-a-uuid',
          format: DEFAULT_COLUMN_PRESENTATION.number,
        },
      }).success,
    ).toBe(false);
  });
});
