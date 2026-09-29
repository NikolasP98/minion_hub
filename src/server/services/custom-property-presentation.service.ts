import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';
import { formulaPrimaryDependencies } from '$lib/tables/formula';

/** Redact presentation-only references which would reveal a hidden formula identity. */
export function projectCustomPropertyPresentations(
  definitions: CustomPropertyDefinition[],
  restrictedDefinitionIds: ReadonlySet<string>,
): CustomPropertyDefinition[] {
  return definitions.map((definition) => {
    const presentation = definition.presentation;
    const secondaryId = presentation?.version === 1 ? presentation.secondary?.propertyId : null;
    if (definition.rules.type === 'formula' && 'version' in definition.rules) {
      if (
        formulaPrimaryDependencies(definition.rules).some((dependency) =>
          restrictedDefinitionIds.has(dependency.id),
        )
      )
        return { ...definition, variablesRestricted: true };
      const visibleVariables = definition.rules.variables.filter(
        (variable) =>
          !variable.dependencies.some((dependency) => restrictedDefinitionIds.has(dependency.id)),
      );
      if (visibleVariables.length !== definition.rules.variables.length) {
        const visibleIds = new Set(visibleVariables.map((variable) => variable.id));
        return {
          ...definition,
          rules: { ...definition.rules, variables: visibleVariables },
          presentation:
            presentation?.version === 2
              ? {
                  ...presentation,
                  variables: presentation.variables.filter((entry) =>
                    visibleIds.has(entry.variableId),
                  ),
                }
              : presentation,
          variablesRestricted: true,
        };
      }
    }
    if (!presentation || !secondaryId || !restrictedDefinitionIds.has(secondaryId))
      return definition;
    return {
      ...definition,
      presentation: { ...presentation, secondary: null },
      presentationRestricted: true,
    };
  });
}
