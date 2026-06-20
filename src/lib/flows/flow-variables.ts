import type { VariableSpec } from './master-flows';

export interface ExportedVariable extends VariableSpec {
	enabled: boolean;
}

function isEnabled(spec: VariableSpec, toggles: Record<string, boolean>): boolean {
	return toggles[spec.key] ?? spec.defaultExported ?? true;
}

export function resolveFlowVariables(
	specs: VariableSpec[],
	toggles: Record<string, boolean>
): ExportedVariable[] {
	return specs.map((s) => ({ ...s, enabled: isEnabled(s, toggles) }));
}

export function flowVariableSchema(
	specs: VariableSpec[],
	toggles: Record<string, boolean>
): VariableSpec[] {
	return specs.filter((s) => isEnabled(s, toggles));
}
