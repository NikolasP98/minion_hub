/**
 * Installs the built-in POS margin formula for one explicitly named org.
 * Safe by default: without --apply this performs validation and prints a plan.
 *
 * Usage:
 *   bun scripts/install-pos-margin-formula.ts \
 *     --org-id <uuid> --expected-org-slug <slug> --actor-profile-id <uuid> \
 *     [--label "Margen (fórmula)"] [--apply]
 */
import postgres from 'postgres';
import { analyzeFormula, FORMULA_LANGUAGE_VERSION } from '../src/lib/tables/formula';
import type { FormulaRules, FormulaSourceDescriptor } from '../src/lib/tables/formula';
import { DEFAULT_FINANCE_CURRENCY } from '../src/lib/finance/defaults';
import { CUSTOM_PROPERTIES_PER_TABLE_MAX } from '../src/lib/tables/custom-property-limits';

export const POS_MARGIN_TEMPLATE_KEY = 'builtin:pos.catalog:margin-v1';
export const POS_MARGIN_EXPRESSION = 'ROUND("Sale price" - "Estimated unit cost", 2)';

type Options = {
  orgId: string;
  expectedOrgSlug: string;
  actorProfileId: string;
  label: string;
  apply: boolean;
};

function required(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1]?.trim() : '';
  if (!value || value.startsWith('--')) throw new Error(`${flag} is required`);
  return value;
}

export function parseOptions(args: string[]): Options {
  const labelIndex = args.indexOf('--label');
  const label = labelIndex >= 0 ? args[labelIndex + 1]?.trim() : 'Margin (formula)';
  if (!label || label.startsWith('--')) throw new Error('--label must be non-empty');
  return {
    orgId: required(args, '--org-id'),
    expectedOrgSlug: required(args, '--expected-org-slug'),
    actorProfileId: required(args, '--actor-profile-id'),
    label,
    apply: args.includes('--apply'),
  };
}

function sources(currency: string): FormulaSourceDescriptor[] {
  const money = {
    kind: 'number' as const,
    dimension: 'money' as const,
    currency,
    basis: 'sellable-unit',
  };
  return [
    {
      id: 'native:pos.catalog:sale-price',
      label: 'Sale price',
      aliases: ['Precio de venta'],
      type: money,
      nullable: true,
      source: 'native',
    },
    {
      id: 'native:pos.catalog:estimated-unit-cost',
      label: 'Estimated unit cost',
      aliases: ['Costo unitario estimado'],
      type: money,
      nullable: true,
      source: 'native',
    },
  ];
}

function rulesFor(currency: string): FormulaRules {
  const analysis = analyzeFormula(POS_MARGIN_EXPRESSION, sources(currency));
  if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
    throw new Error(`template formula invalid: ${analysis.diagnostics[0]?.code ?? 'unknown'}`);
  return {
    type: 'formula',
    expression: POS_MARGIN_EXPRESSION,
    languageVersion: FORMULA_LANGUAGE_VERSION,
    ast: analysis.ast,
    outputType: analysis.outputType,
    dependencies: analysis.dependencies,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required');
  const db = postgres(url, { prepare: false, max: 1 });
  try {
    const result = await db.begin(async (tx) => {
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
      const [existing] = await tx<{ id: string; label: string; archived_at: Date | null }[]>`
        select id::text, label, archived_at from app_table_properties
        where org_id = ${options.orgId} and table_id = 'pos.catalog'
          and template_key = ${POS_MARGIN_TEMPLATE_KEY}
        limit 1
      `;
      if (existing)
        return {
          outcome: 'unchanged',
          org: org.name,
          definitionId: existing.id,
          label: existing.label,
        };
      const [collision] = await tx<{ id: string }[]>`
        select id::text from app_table_properties
        where org_id = ${options.orgId} and table_id = 'pos.catalog'
          and archived_at is null and lower(label) = lower(${options.label})
        limit 1
      `;
      if (collision) throw new Error('label_collision');
      const [{ active_count: activeCount }] = await tx<{ active_count: number }[]>`
        select count(*)::int as active_count from app_table_properties
        where org_id = ${options.orgId} and table_id = 'pos.catalog' and archived_at is null
      `;
      if (activeCount >= CUSTOM_PROPERTIES_PER_TABLE_MAX) throw new Error('property_limit');
      const [{ currency }] = await tx<{ currency: string }[]>`
        select coalesce(
          (select currency from fin_settings where org_id = ${options.orgId}),
          ${DEFAULT_FINANCE_CURRENCY}
        ) as currency
      `;
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('invalid_org_currency');
      const rules = rulesFor(currency);
      if (!options.apply)
        return { outcome: 'dry-run', org: org.name, definitionId: null, label: options.label };
      const [created] = await tx<{ id: string }[]>`
        insert into app_table_properties
          (org_id, table_id, template_key, label, description, rules, has_default,
           default_value, created_by, updated_by)
        values
          (${options.orgId}, 'pos.catalog', ${POS_MARGIN_TEMPLATE_KEY}, ${options.label},
           'Sale price minus estimated unit cost.', ${tx.json(rules)}, 0, null,
           ${options.actorProfileId}, ${options.actorProfileId})
        returning id::text
      `;
      return {
        outcome: 'installed',
        org: org.name,
        definitionId: created.id,
        label: options.label,
      };
    });
    console.log(JSON.stringify(result));
  } finally {
    await db.end();
  }
}

if (import.meta.main) await main();
