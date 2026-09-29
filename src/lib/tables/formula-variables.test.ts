import { describe, expect, it } from 'vitest';
import { formulaDraftRulesV2Schema } from './custom-properties';
import { columnPresentationV2Schema, defaultVariablePresentation } from './column-presentation';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const draft = (variables: Array<{ id: string; name: string | null; expression: string }>) => ({
  type: 'formula' as const,
  version: 2 as const,
  primaryVariableId: A,
  variables,
});

describe('formula variable contracts', () => {
  it('accepts one unnamed variable and rejects a named singleton', () => {
    expect(
      formulaDraftRulesV2Schema.safeParse(draft([{ id: A, name: null, expression: '1' }])).success,
    ).toBe(true);
    expect(
      formulaDraftRulesV2Schema.safeParse(draft([{ id: A, name: 'Value', expression: '1' }]))
        .success,
    ).toBe(false);
  });

  it('requires unique normalized names and an existing primary', () => {
    expect(
      formulaDraftRulesV2Schema.safeParse(
        draft([
          { id: A, name: ' Margin ', expression: '1' },
          { id: B, name: 'Ｍａｒｇｉｎ', expression: '2' },
        ]),
      ).success,
    ).toBe(false);
    expect(
      formulaDraftRulesV2Schema.safeParse({
        ...draft([
          { id: A, name: 'Margin', expression: '1' },
          { id: B, name: 'Ratio', expression: '2' },
        ]),
        primaryVariableId: '00000000-0000-4000-8000-000000000099',
      }).success,
    ).toBe(false);
  });

  it('keeps variable formatting keyed by UUID with deterministic emphasis defaults', () => {
    expect(
      columnPresentationV2Schema.safeParse({
        version: 2,
        variables: [defaultVariablePresentation(A, true), defaultVariablePresentation(B, false)],
      }).success,
    ).toBe(true);
    expect(defaultVariablePresentation(A, true).emphasis).toBe('normal');
    expect(defaultVariablePresentation(B, false).emphasis).toBe('muted');
  });
});
