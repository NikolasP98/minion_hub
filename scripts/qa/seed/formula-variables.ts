import type { SeedContext } from './db';
import { matrixUuid } from './ids';
import { ORG_BUSINESS, userId } from './tenancy';
import {
  analyzeFormula,
  FORMULA_LANGUAGE_VERSION,
  type FormulaSourceDescriptor,
  type FormulaVariableRules,
} from '../../../src/lib/tables/formula';
import { columnPresentationV2Schema } from '../../../src/lib/tables/column-presentation';

export const FORMULA_VARIABLES_COMPOSITE = matrixUuid('formula.variables.margin-ratio');
export const FORMULA_VARIABLES_PRIMARY = matrixUuid('formula.variables.margin-ratio', 'primary');
export const FORMULA_VARIABLES_RATIO = matrixUuid('formula.variables.margin-ratio', 'ratio');
export const FORMULA_VARIABLES_LEGACY_PRIMARY = matrixUuid('formula.variables.legacy-primary');
export const FORMULA_VARIABLES_LEGACY_SECONDARY = matrixUuid('formula.variables.legacy-secondary');

const nativeSources: FormulaSourceDescriptor[] = [
  {
    id: 'native:pos.catalog:sale-price',
    label: 'Sale price',
    aliases: ['Precio de venta'],
    type: { kind: 'number', dimension: 'money', currency: 'PEN', basis: 'sellable-unit' },
    nullable: true,
    source: 'native',
  },
  {
    id: 'native:pos.catalog:estimated-unit-cost',
    label: 'Estimated unit cost',
    aliases: ['Costo unitario estimado'],
    type: { kind: 'number', dimension: 'money', currency: 'PEN', basis: 'sellable-unit' },
    nullable: true,
    source: 'native',
  },
];

function variable(
  id: string,
  name: string,
  expression: string,
  sources = nativeSources,
): FormulaVariableRules {
  const analysis = analyzeFormula(expression, sources);
  if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
    throw new Error(`invalid formula-variable seed: ${analysis.diagnostics[0]?.code}`);
  return {
    id,
    name,
    expression,
    languageVersion: FORMULA_LANGUAGE_VERSION,
    ast: analysis.ast,
    outputType: analysis.outputType,
    dependencies: analysis.dependencies,
  };
}

function v1(expression: string) {
  const analysis = analyzeFormula(expression, []);
  if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
    throw new Error(`invalid legacy formula-variable seed: ${analysis.diagnostics[0]?.code}`);
  return {
    type: 'formula' as const,
    expression,
    languageVersion: FORMULA_LANGUAGE_VERSION,
    ast: analysis.ast,
    outputType: analysis.outputType,
    dependencies: analysis.dependencies,
  };
}

export async function seed(ctx: SeedContext): Promise<void> {
  const owner = userId('tenancy.user.owner');
  const margin = variable(
    FORMULA_VARIABLES_PRIMARY,
    'Margin',
    'ROUND("Sale price" - "Estimated unit cost", 2)',
  );
  const ratio = variable(
    FORMULA_VARIABLES_RATIO,
    'Margin %',
    '("Sale price" - "Estimated unit cost") / NULLIF("Sale price", "Sale price" * 0)',
  );
  const rules = {
    type: 'formula' as const,
    version: 2 as const,
    primaryVariableId: FORMULA_VARIABLES_PRIMARY,
    variables: [margin, ratio],
  };
  const presentation = columnPresentationV2Schema.parse({
    version: 2,
    variables: [
      {
        variableId: FORMULA_VARIABLES_PRIMARY,
        number: {
          style: 'currency',
          decimals: 2,
          currencyDisplay: 'symbol',
          percentScale: 'whole',
        },
        tone: 'sign',
        emphasis: 'normal',
      },
      {
        variableId: FORMULA_VARIABLES_RATIO,
        number: { style: 'percent', decimals: 1, currencyDisplay: 'symbol', percentScale: 'ratio' },
        tone: 'none',
        emphasis: 'muted',
      },
    ],
  });
  await ctx.sql`
    insert into app_table_properties
      (id, org_id, table_id, label, description, rules, presentation,
       has_default, default_value, version, created_by, updated_by)
    values
      (${FORMULA_VARIABLES_COMPOSITE}, ${ORG_BUSINESS}, 'pos.catalog',
       'QA Margin composite', 'Two ordered formula variables with stable primary semantics.',
       ${ctx.sql.json(rules)}, ${ctx.sql.json(presentation)}, 0, null, 1, ${owner}, ${owner})
    on conflict (org_id, id) do update set
      table_id = excluded.table_id, label = excluded.label, description = excluded.description,
      rules = excluded.rules, presentation = excluded.presentation, updated_by = excluded.updated_by
  `;
  ctx.register('formula.variables.margin-ratio', {
    table: 'app_table_properties',
    where: { org_id: ORG_BUSINESS, id: FORMULA_VARIABLES_COMPOSITE, table_id: 'pos.catalog' },
  });

  const legacyPresentation = {
    version: 1,
    number: { style: 'decimal', decimals: 2, currencyDisplay: 'symbol', percentScale: 'whole' },
    tone: 'sign',
    secondary: {
      propertyId: FORMULA_VARIABLES_LEGACY_SECONDARY,
      format: { style: 'percent', decimals: 1, currencyDisplay: 'symbol', percentScale: 'ratio' },
    },
  };
  const legacy = [
    {
      id: FORMULA_VARIABLES_LEGACY_PRIMARY,
      matrixId: 'formula.variables.legacy-primary',
      label: 'QA Legacy primary',
      rules: v1('10.25'),
      presentation: legacyPresentation,
    },
    {
      id: FORMULA_VARIABLES_LEGACY_SECONDARY,
      matrixId: 'formula.variables.legacy-secondary',
      label: 'QA Legacy ratio',
      rules: v1('0.2'),
      presentation: null,
    },
  ] as const;
  for (const fixture of legacy) {
    await ctx.sql`
      insert into app_table_properties
        (id, org_id, table_id, label, description, rules, presentation,
         has_default, default_value, version, created_by, updated_by)
      values
        (${fixture.id}, ${ORG_BUSINESS}, 'stock.items', ${fixture.label},
         'Intact v1 formula-variable compatibility fixture', ${ctx.sql.json(fixture.rules)},
         ${fixture.presentation ? ctx.sql.json(fixture.presentation) : null},
         0, null, 1, ${owner}, ${owner})
      on conflict (org_id, id) do update set
        table_id = excluded.table_id, label = excluded.label, description = excluded.description,
        rules = excluded.rules, presentation = excluded.presentation, updated_by = excluded.updated_by
    `;
    ctx.register(fixture.matrixId, {
      table: 'app_table_properties',
      where: { org_id: ORG_BUSINESS, id: fixture.id, table_id: 'stock.items' },
    });
  }
}
