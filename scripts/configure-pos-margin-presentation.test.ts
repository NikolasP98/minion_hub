import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATIO_LABEL,
  POS_MARGIN_EXPRESSION,
  POS_MARGIN_RATIO_TEMPLATE_KEY,
  POS_MARGIN_TEMPLATE_KEY,
  assessConfiguration,
  desiredMarginPresentation,
  expectedMarginRules,
  expectedRatioRules,
  parseOptions,
  type ConfigureMarginOptions,
  type FormulaRow,
} from './configure-pos-margin-presentation';

const marginId = '10000000-0000-4000-8000-000000000001';
const ratioId = '10000000-0000-4000-8000-000000000002';
const actorId = '10000000-0000-4000-8000-000000000003';

const options: ConfigureMarginOptions = {
  orgId: '10000000-0000-4000-8000-000000000004',
  expectedOrgSlug: 'faces-sculptors',
  actorProfileId: actorId,
  expectedMarginId: marginId,
  expectedMarginVersion: 3,
  ratioLabel: DEFAULT_RATIO_LABEL,
  apply: false,
};

function margin(presentation: FormulaRow['presentation'] = null): FormulaRow {
  return {
    id: marginId,
    label: 'Margin (formula)',
    description: 'Sale price minus estimated unit cost.',
    template_key: POS_MARGIN_TEMPLATE_KEY,
    rules: expectedMarginRules('PEN'),
    presentation,
    version: 3,
    archived_at: null,
  };
}

function ratio(primary = margin()): FormulaRow {
  return {
    id: ratioId,
    label: DEFAULT_RATIO_LABEL,
    description: 'Margin divided by sale price.',
    template_key: POS_MARGIN_RATIO_TEMPLATE_KEY,
    rules: expectedRatioRules('PEN', primary),
    presentation: null,
    version: 1,
    archived_at: null,
  };
}

describe('configure POS margin presentation', () => {
  it('requires exact targeting guards and is dry-run by default', () => {
    expect(() => parseOptions([])).toThrow('--expected-margin-version is required');
    expect(
      parseOptions([
        '--org-id',
        options.orgId,
        '--expected-org-slug',
        options.expectedOrgSlug,
        '--actor-profile-id',
        actorId,
        '--expected-margin-id',
        marginId,
        '--expected-margin-version',
        '3',
      ]),
    ).toEqual(options);
    expect(() =>
      parseOptions([
        '--org-id',
        'not-a-uuid',
        '--expected-org-slug',
        'slug',
        '--actor-profile-id',
        actorId,
        '--expected-margin-id',
        marginId,
        '--expected-margin-version',
        '3',
      ]),
    ).toThrow('--org-id must be a UUID');
    expect(() =>
      parseOptions([
        '--org-id',
        options.orgId,
        '--expected-org-slug',
        'slug',
        '--actor-profile-id',
        actorId,
        '--expected-margin-id',
        marginId,
        '--expected-margin-version',
        '3',
        '--ratio-label',
        'x'.repeat(81),
      ]),
    ).toThrow('--ratio-label must be at most 80 characters');
  });

  it('plans only the canonical original formula at the expected version', () => {
    expect(assessConfiguration(margin(), undefined, options, 'PEN')).toBe('ready');
    expect(expectedRatioRules('PEN', margin())).toMatchObject({
      expression: '"Margin (formula)" / NULLIF("Sale price", "Sale price" * 0)',
      outputType: { kind: 'number', dimension: 'unitless' },
    });
    expect(() =>
      assessConfiguration({ ...margin(), version: 4 }, undefined, options, 'PEN'),
    ).toThrow('margin_version_conflict');
    expect(() =>
      assessConfiguration(
        { ...margin(), rules: { ...margin().rules, expression: `${POS_MARGIN_EXPRESSION} + 1` } },
        undefined,
        options,
        'PEN',
      ),
    ).toThrow('margin_expression_modified');
  });

  it('recognizes an exact replay without requiring the original CAS version', () => {
    const configured = { ...margin(desiredMarginPresentation(ratioId)), version: 9 };
    expect(assessConfiguration(configured, ratio(configured), options, 'PEN')).toBe('unchanged');
  });

  it('rejects user-modified margin presentation and ratio template state', () => {
    const changedPresentation = {
      ...desiredMarginPresentation(ratioId),
      tone: 'none' as const,
    };
    expect(() => assessConfiguration(margin(changedPresentation), ratio(), options, 'PEN')).toThrow(
      'margin_presentation_modified',
    );
    expect(() =>
      assessConfiguration(margin(), { ...ratio(), label: 'User ratio label' }, options, 'PEN'),
    ).toThrow('ratio_template_modified');
    expect(() =>
      assessConfiguration(
        margin(),
        { ...ratio(), presentation: desiredMarginPresentation(ratioId) },
        options,
        'PEN',
      ),
    ).toThrow('ratio_template_modified');
  });
});
