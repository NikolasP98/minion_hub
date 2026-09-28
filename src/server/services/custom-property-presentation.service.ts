import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';

/** Redact presentation-only references which would reveal a hidden formula identity. */
export function projectCustomPropertyPresentations(
  definitions: CustomPropertyDefinition[],
  restrictedDefinitionIds: ReadonlySet<string>,
): CustomPropertyDefinition[] {
  return definitions.map((definition) => {
    const presentation = definition.presentation;
    const secondaryId = presentation?.secondary?.propertyId;
    if (!presentation || !secondaryId || !restrictedDefinitionIds.has(secondaryId))
      return definition;
    return {
      ...definition,
      presentation: { ...presentation, secondary: null },
      presentationRestricted: true,
    };
  });
}
