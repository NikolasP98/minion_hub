import { describe, expect, it } from 'vitest';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import { DEFAULT_COLUMN_PRESENTATION } from '$lib/tables/column-presentation';
import { projectCustomPropertyPresentations } from './custom-property-presentation.service';

const secondaryId = '00000000-0000-4000-8000-000000000002';
const definition = {
  id: '00000000-0000-4000-8000-000000000001',
  presentation: {
    ...DEFAULT_COLUMN_PRESENTATION,
    secondary: { propertyId: secondaryId, format: DEFAULT_COLUMN_PRESENTATION.number },
  },
} as CustomPropertyDefinition;

describe('custom property presentation projection', () => {
  it('redacts a restricted secondary identity without mutating the canonical definition', () => {
    const [projected] = projectCustomPropertyPresentations([definition], new Set([secondaryId]));
    expect(projected).toMatchObject({
      presentation: { secondary: null },
      presentationRestricted: true,
    });
    expect(definition.presentation?.secondary?.propertyId).toBe(secondaryId);
  });

  it('preserves an authorized secondary presentation', () => {
    expect(projectCustomPropertyPresentations([definition], new Set())[0]).toBe(definition);
  });
});
