/**
 * Configure the explicitly installed POS margin formula for one named org and
 * create its durable ratio companion. Safe by default: --apply is required.
 *
 * Usage:
 *   bun scripts/configure-pos-margin-presentation.ts \
 *     --org-id <uuid> --expected-org-slug <slug> --actor-profile-id <uuid> \
 *     --expected-margin-id <uuid> --expected-margin-version <integer> [--apply]
 */
import postgres from 'postgres';
import { analyzeFormula, FORMULA_LANGUAGE_VERSION } from '../src/lib/tables/formula';
import type { FormulaAst, FormulaRules, FormulaSourceDescriptor } from '../src/lib/tables/formula';
import { DEFAULT_FINANCE_CURRENCY } from '../src/lib/finance/defaults';
import {
  CUSTOM_PROPERTIES_PER_TABLE_MAX,
  CUSTOM_PROPERTY_LABEL_MAX,
} from '../src/lib/tables/custom-property-limits';
import {
  columnPresentationSchema,
  type ColumnPresentation,
} from '../src/lib/tables/column-presentation';

export const POS_MARGIN_TEMPLATE_KEY = 'builtin:pos.catalog:margin-v1';
export const POS_MARGIN_RATIO_TEMPLATE_KEY = 'builtin:pos.catalog:margin-ratio-v1';
export const POS_MARGIN_EXPRESSION = 'ROUND("Sale price" - "Estimated unit cost", 2)';
export const DEFAULT_RATIO_LABEL = 'Margin ratio (formula)';

export type ConfigureMarginOptions = {
  orgId: string;
  expectedOrgSlug: string;
  actorProfileId: string;
  expectedMarginId: string;
  expectedMarginVersion: number;
  ratioLabel: string;
  apply: boolean;
};

export type FormulaRow = {
  id: string;
  label: string;
  description: string | null;
  template_key: string | null;
  rules: FormulaRules;
  presentation: ColumnPresentation | null;
  version: number;
  archived_at: Date | null;
};

function required(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1]?.trim() : '';
  if (!value || value.startsWith('--')) throw new Error(`${flag} is required`);
  return value;
}

function requiredUuid(args: string[], flag: string): string {
  const value = required(args, flag);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new Error(`${flag} must be a UUID`);
  return value;
}

export function parseOptions(args: string[]): ConfigureMarginOptions {
  const version = Number(required(args, '--expected-margin-version'));
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('--expected-margin-version must be a positive integer');
  const ratioLabelIndex = args.indexOf('--ratio-label');
  const ratioLabel = ratioLabelIndex >= 0 ? args[ratioLabelIndex + 1]?.trim() : DEFAULT_RATIO_LABEL;
  if (!ratioLabel || ratioLabel.startsWith('--'))
    throw new Error('--ratio-label must be non-empty');
  if (ratioLabel.length > CUSTOM_PROPERTY_LABEL_MAX)
    throw new Error(`--ratio-label must be at most ${CUSTOM_PROPERTY_LABEL_MAX} characters`);
  return {
    orgId: requiredUuid(args, '--org-id'),
    expectedOrgSlug: required(args, '--expected-org-slug'),
    actorProfileId: requiredUuid(args, '--actor-profile-id'),
    expectedMarginId: requiredUuid(args, '--expected-margin-id'),
    expectedMarginVersion: version,
    ratioLabel,
    apply: args.includes('--apply'),
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function semanticAst(ast: FormulaAst): unknown {
  if (ast.kind === 'literal') return { kind: ast.kind, value: ast.value, valueType: ast.valueType };
  if (ast.kind === 'reference') return { kind: ast.kind, sourceId: ast.sourceId };
  if (ast.kind === 'unary')
    return { kind: ast.kind, operator: ast.operator, operand: semanticAst(ast.operand) };
  if (ast.kind === 'binary')
    return {
      kind: ast.kind,
      operator: ast.operator,
      left: semanticAst(ast.left),
      right: semanticAst(ast.right),
    };
  if (ast.kind === 'is_null')
    return { kind: ast.kind, negated: ast.negated, operand: semanticAst(ast.operand) };
  if (ast.kind === 'call')
    return { kind: ast.kind, name: ast.name, arguments: ast.arguments.map(semanticAst) };
  return {
    kind: ast.kind,
    branches: ast.branches.map((branch) => ({
      when: semanticAst(branch.when),
      then: semanticAst(branch.then),
    })),
    otherwise: semanticAst(ast.otherwise),
  };
}

function moneyType(currency: string) {
  return {
    kind: 'number' as const,
    dimension: 'money' as const,
    currency,
    basis: 'sellable-unit',
  };
}

function nativeSources(currency: string): FormulaSourceDescriptor[] {
  const type = moneyType(currency);
  return [
    {
      id: 'native:pos.catalog:sale-price',
      label: 'Sale price',
      aliases: ['Precio de venta'],
      type,
      nullable: true,
      source: 'native',
    },
    {
      id: 'native:pos.catalog:estimated-unit-cost',
      label: 'Estimated unit cost',
      aliases: ['Costo unitario estimado'],
      type,
      nullable: true,
      source: 'native',
    },
  ];
}

function analyzedRules(expression: string, sources: FormulaSourceDescriptor[]): FormulaRules {
  const analysis = analyzeFormula(expression, sources);
  if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
    throw new Error(`template_formula_invalid:${analysis.diagnostics[0]?.code ?? 'unknown'}`);
  return {
    type: 'formula',
    expression,
    languageVersion: FORMULA_LANGUAGE_VERSION,
    ast: analysis.ast,
    outputType: analysis.outputType,
    dependencies: analysis.dependencies,
  };
}

export function expectedMarginRules(currency: string): FormulaRules {
  return analyzedRules(POS_MARGIN_EXPRESSION, nativeSources(currency));
}

function ratioExpression(marginLabel: string): string {
  const quoted = `"${marginLabel.replaceAll('"', '""')}"`;
  return `${quoted} / NULLIF("Sale price", "Sale price" * 0)`;
}

export function expectedRatioRules(
  currency: string,
  margin: Pick<FormulaRow, 'id' | 'label' | 'rules'>,
): FormulaRules {
  if (margin.rules.outputType.kind !== 'number' || margin.rules.outputType.dimension !== 'money')
    throw new Error('margin_output_not_money');
  return analyzedRules(ratioExpression(margin.label), [
    ...nativeSources(currency),
    {
      id: margin.id,
      label: margin.label,
      aliases: [],
      type: margin.rules.outputType,
      nullable: margin.rules.outputType.nullable,
      source: 'formula',
    },
  ]);
}

export function desiredMarginPresentation(ratioId: string): ColumnPresentation {
  return columnPresentationSchema.parse({
    version: 1,
    number: {
      style: 'currency',
      decimals: 2,
      currencyDisplay: 'symbol',
      percentScale: 'whole',
    },
    tone: 'sign',
    secondary: {
      propertyId: ratioId,
      format: {
        style: 'percent',
        decimals: 1,
        currencyDisplay: 'symbol',
        percentScale: 'ratio',
      },
    },
  });
}

function sameRules(left: FormulaRules, right: FormulaRules): boolean {
  return (
    left.type === 'formula' &&
    left.languageVersion === right.languageVersion &&
    canonical(left.outputType) === canonical(right.outputType) &&
    canonical(left.dependencies) === canonical(right.dependencies) &&
    canonical(semanticAst(left.ast)) === canonical(semanticAst(right.ast))
  );
}

export function assertOriginalMargin(
  margin: FormulaRow | undefined,
  options: ConfigureMarginOptions,
  currency: string,
): FormulaRow {
  if (!margin || margin.id !== options.expectedMarginId)
    throw new Error('margin_identity_mismatch');
  if (margin.template_key !== POS_MARGIN_TEMPLATE_KEY) throw new Error('margin_template_mismatch');
  if (margin.archived_at) throw new Error('margin_archived');
  if (margin.rules.type !== 'formula' || margin.rules.expression !== POS_MARGIN_EXPRESSION)
    throw new Error('margin_expression_modified');
  if (!sameRules(margin.rules, expectedMarginRules(currency)))
    throw new Error('margin_rules_modified');
  return margin;
}

export function assertExistingRatio(
  ratio: FormulaRow,
  expected: FormulaRules,
  ratioLabel: string,
): void {
  if (ratio.template_key !== POS_MARGIN_RATIO_TEMPLATE_KEY)
    throw new Error('ratio_template_mismatch');
  if (ratio.archived_at) throw new Error('ratio_template_archived');
  if (ratio.label !== ratioLabel || ratio.description !== 'Margin divided by sale price.')
    throw new Error('ratio_template_modified');
  if (ratio.presentation !== null || !sameRules(ratio.rules, expected))
    throw new Error('ratio_template_modified');
}

export function assessConfiguration(
  margin: FormulaRow | undefined,
  ratio: FormulaRow | undefined,
  options: ConfigureMarginOptions,
  currency: string,
): 'ready' | 'unchanged' {
  const checkedMargin = assertOriginalMargin(margin, options, currency);
  if (ratio) {
    assertExistingRatio(ratio, expectedRatioRules(currency, checkedMargin), options.ratioLabel);
    if (canonical(checkedMargin.presentation) === canonical(desiredMarginPresentation(ratio.id)))
      return 'unchanged';
  }
  if (checkedMargin.presentation !== null) throw new Error('margin_presentation_modified');
  if (checkedMargin.version !== options.expectedMarginVersion)
    throw new Error('margin_version_conflict');
  return 'ready';
}

function outcome(
  kind: 'dry-run' | 'configured' | 'unchanged',
  org: string,
  margin: FormulaRow,
  ratio: FormulaRow | null,
  changes: Array<'create_ratio' | 'configure_margin'>,
) {
  return {
    outcome: kind,
    org,
    margin: { id: margin.id, version: margin.version, templateKey: margin.template_key },
    ratio: ratio
      ? { id: ratio.id, version: ratio.version, templateKey: ratio.template_key }
      : { id: null, version: null, templateKey: POS_MARGIN_RATIO_TEMPLATE_KEY },
    changes,
  };
}

export async function configurePosMarginPresentation(options: ConfigureMarginOptions) {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required');
  const db = postgres(url, { prepare: false, max: 1 });
  try {
    return await db.begin(async (tx) => {
      const [org] = await tx<{ id: string; slug: string; name: string }[]>`
        select id::text, slug, name from organizations where id::text = ${options.orgId} limit 1
      `;
      if (!org || org.slug !== options.expectedOrgSlug) throw new Error('organization_mismatch');
      const [membership] = await tx<{ role: string }[]>`
        select role from organization_members
        where organization_id::text = ${options.orgId}
          and profile_id::text = ${options.actorProfileId}
        limit 1
      `;
      if (!membership || membership.role !== 'owner') throw new Error('actor_not_org_owner');
      await tx`select pg_advisory_xact_lock(hashtext(${`${options.orgId}:pos.catalog`}))`;

      const [{ currency: rawCurrency }] = await tx<{ currency: string }[]>`
        select coalesce(
          (select currency from fin_settings where org_id = ${options.orgId}),
          ${DEFAULT_FINANCE_CURRENCY}
        ) as currency
      `;
      const currency = rawCurrency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('invalid_org_currency');

      const [margin] = await tx<FormulaRow[]>`
        select id::text, label, description, template_key, rules, presentation,
               version, archived_at
        from app_table_properties
        where org_id = ${options.orgId} and table_id = 'pos.catalog'
          and template_key = ${POS_MARGIN_TEMPLATE_KEY}
        limit 1
      `;
      const [ratio] = await tx<FormulaRow[]>`
        select id::text, label, description, template_key, rules, presentation,
               version, archived_at
        from app_table_properties
        where org_id = ${options.orgId} and table_id = 'pos.catalog'
          and template_key = ${POS_MARGIN_RATIO_TEMPLATE_KEY}
        limit 1
      `;
      const checkedMargin = assertOriginalMargin(margin, options, currency);
      const state = assessConfiguration(checkedMargin, ratio, options, currency);
      const ratioRules = expectedRatioRules(currency, checkedMargin);

      if (state === 'unchanged') return outcome('unchanged', org.name, checkedMargin, ratio, []);

      if (!ratio) {
        const [collision] = await tx<{ id: string }[]>`
          select id::text from app_table_properties
          where org_id = ${options.orgId} and table_id = 'pos.catalog'
            and archived_at is null and lower(label) = lower(${options.ratioLabel})
          limit 1
        `;
        if (collision) throw new Error('ratio_label_collision');
        const [{ active_count: activeCount }] = await tx<{ active_count: number }[]>`
          select count(*)::int as active_count from app_table_properties
          where org_id = ${options.orgId} and table_id = 'pos.catalog' and archived_at is null
        `;
        if (activeCount >= CUSTOM_PROPERTIES_PER_TABLE_MAX) throw new Error('property_limit');
      }

      if (!options.apply)
        return outcome('dry-run', org.name, checkedMargin, ratio ?? null, [
          ...(!ratio ? (['create_ratio'] as const) : []),
          'configure_margin',
        ]);

      const createsRatio = !ratio;
      let configuredRatio = ratio;
      if (!configuredRatio) {
        [configuredRatio] = await tx<FormulaRow[]>`
          insert into app_table_properties
            (org_id, table_id, template_key, label, description, rules, presentation,
             has_default, default_value, created_by, updated_by)
          values
            (${options.orgId}, 'pos.catalog', ${POS_MARGIN_RATIO_TEMPLATE_KEY},
             ${options.ratioLabel}, 'Margin divided by sale price.', ${tx.json(ratioRules)}, null,
             0, null, ${options.actorProfileId}, ${options.actorProfileId})
          returning id::text, label, description, template_key, rules, presentation,
                    version, archived_at
        `;
      }
      if (!configuredRatio) throw new Error('ratio_insert_failed');
      const presentation = desiredMarginPresentation(configuredRatio.id);
      const [configuredMargin] = await tx<FormulaRow[]>`
        update app_table_properties
        set presentation = ${tx.json(presentation)}, version = version + 1,
            updated_by = ${options.actorProfileId}, updated_at = now()
        where org_id = ${options.orgId} and table_id = 'pos.catalog'
          and id = ${options.expectedMarginId}
          and template_key = ${POS_MARGIN_TEMPLATE_KEY}
          and version = ${options.expectedMarginVersion}
          and presentation is null
        returning id::text, label, description, template_key, rules, presentation,
                  version, archived_at
      `;
      if (!configuredMargin) throw new Error('margin_version_conflict');

      const [readback] = await tx<FormulaRow[]>`
        select id::text, label, description, template_key, rules, presentation,
               version, archived_at
        from app_table_properties
        where org_id = ${options.orgId} and table_id = 'pos.catalog'
          and id = ${options.expectedMarginId}
        limit 1
      `;
      if (!readback || canonical(readback.presentation) !== canonical(presentation))
        throw new Error('presentation_readback_failed');
      const [ratioReadback] = await tx<FormulaRow[]>`
        select id::text, label, description, template_key, rules, presentation,
               version, archived_at
        from app_table_properties
        where org_id = ${options.orgId} and table_id = 'pos.catalog'
          and id = ${configuredRatio.id}
        limit 1
      `;
      if (!ratioReadback) throw new Error('ratio_readback_failed');
      assertExistingRatio(ratioReadback, ratioRules, options.ratioLabel);
      return outcome('configured', org.name, readback, ratioReadback, [
        ...(createsRatio ? (['create_ratio'] as const) : []),
        'configure_margin',
      ]);
    });
  } finally {
    await db.end();
  }
}

async function main(): Promise<void> {
  const result = await configurePosMarginPresentation(parseOptions(process.argv.slice(2)));
  console.log(JSON.stringify(result));
}

if (import.meta.main) await main();
