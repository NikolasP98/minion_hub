/**
 * Read-only comparison of the installed POS margin formula with the canonical
 * native margin for every catalog row the named actor may view.
 *
 * Usage:
 *   bun scripts/compare-pos-margin-formula.ts --org-id <uuid> \
 *     --expected-org-slug <slug> --actor-profile-id <uuid>
 */
import postgres from 'postgres';
import { createServer } from 'vite';
import type { CoreCtx } from '../src/server/auth/core-ctx';
import type {
  CustomPropertyDefinition,
  CustomPropertyValueCell,
} from '../src/lib/tables/custom-properties';
import type { FormulaNativeComparison } from '../src/lib/tables/formula';

export const POS_MARGIN_TEMPLATE_KEY = 'builtin:pos.catalog:margin-v1';

type Options = { orgId: string; expectedOrgSlug: string; actorProfileId: string };

function required(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1]?.trim() : '';
  if (!value || value.startsWith('--')) throw new Error(`${flag} is required`);
  return value;
}

export function parseOptions(args: string[]): Options {
  return {
    orgId: required(args, '--org-id'),
    expectedOrgSlug: required(args, '--expected-org-slug'),
    actorProfileId: required(args, '--actor-profile-id'),
  };
}

type Sellable = { productId: string };
type FormulaInput = { value: unknown; quality: string };
type FormulaInputs = Record<string, Record<string, FormulaInput>>;
type FormulaEvaluation = {
  cells: Record<string, Record<string, CustomPropertyValueCell>>;
};

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required');
  const db = postgres(url, { prepare: false, max: 1 });
  const vite = await createServer({
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'error',
  });
  try {
    const [org] = await db<{ id: string; slug: string }[]>`
      select id::text, slug from organizations where id::text = ${options.orgId} limit 1
    `;
    if (!org || org.slug !== options.expectedOrgSlug) throw new Error('organization_mismatch');
    const [membership] = await db<{ present: boolean }[]>`
      select true as present from organization_members
      where organization_id::text = ${options.orgId}
        and profile_id::text = ${options.actorProfileId}
      limit 1
    `;
    if (!membership) throw new Error('actor_not_org_member');
    const [installed] = await db<{ id: string }[]>`
      select id::text from app_table_properties
      where org_id = ${options.orgId} and table_id = 'pos.catalog'
        and template_key = ${POS_MARGIN_TEMPLATE_KEY} and archived_at is null
      limit 1
    `;
    if (!installed) throw new Error('margin_formula_not_installed');

    const [
      { getCoreDb },
      { resolveCapabilities },
      propertyService,
      formulaService,
      posService,
      entityService,
    ] = await Promise.all([
      vite.ssrLoadModule('/src/server/db/pg-client.ts') as Promise<{
        getCoreDb: () => CoreCtx['db'];
      }>,
      vite.ssrLoadModule('/src/server/services/rbac.service.ts') as Promise<{
        resolveCapabilities: (
          orgId: string,
          profileId: string,
        ) => Promise<{ can: (module: string, action: string) => boolean }>;
      }>,
      vite.ssrLoadModule('/src/server/services/custom-properties.service.ts') as Promise<{
        listCustomProperties: (
          ctx: CoreCtx,
          tableId: string,
        ) => Promise<CustomPropertyDefinition[]>;
        readCustomPropertyValues: (
          ctx: CoreCtx,
          tableId: string,
          recordIds: string[],
          definitions: CustomPropertyDefinition[],
        ) => Promise<Record<string, Record<string, CustomPropertyValueCell>>>;
      }>,
      vite.ssrLoadModule('/src/server/services/formula-properties.service.ts') as Promise<{
        POS_FORMULA_SOURCE_IDS: { nativeMargin: string };
        loadFormulaCatalog: (
          locals: App.Locals,
          ctx: CoreCtx,
          tableId: string,
          definitions: CustomPropertyDefinition[],
        ) => Promise<{ definitions: CustomPropertyDefinition[]; fields: unknown[] }>;
        loadFormulaInputs: (
          ctx: CoreCtx,
          tableId: string,
          recordIds: string[],
          values: Record<string, Record<string, CustomPropertyValueCell>>,
        ) => Promise<FormulaInputs>;
        evaluateFormulaDefinitions: (
          ctx: CoreCtx,
          definitions: CustomPropertyDefinition[],
          sources: unknown[],
          inputs: FormulaInputs,
        ) => Promise<FormulaEvaluation>;
        nativeMarginComparison: (
          result: CustomPropertyValueCell['value'],
          native: FormulaInput | undefined,
        ) => FormulaNativeComparison;
      }>,
      vite.ssrLoadModule('/src/server/services/pos.service.ts') as Promise<{
        listSellables: (ctx: CoreCtx, options: { includeInactive: boolean }) => Promise<Sellable[]>;
      }>,
      vite.ssrLoadModule('/src/server/services/custom-property-entities.service.ts') as Promise<{
        authorizeCustomPropertyRecords: (
          locals: App.Locals,
          ctx: CoreCtx,
          tableId: string,
          ids: string[],
          action: 'view',
        ) => Promise<Record<string, boolean>>;
      }>,
    ]);

    const capabilities = await resolveCapabilities(options.orgId, options.actorProfileId);
    if (!capabilities.can('pos', 'view')) throw new Error('actor_cannot_view_pos');
    const ctx: CoreCtx = {
      db: getCoreDb(),
      tenantId: options.orgId,
      profileId: options.actorProfileId,
    };
    const locals = {
      user: { supabaseId: options.actorProfileId, role: 'user' },
      tenantCtx: { tenantId: options.orgId },
    } as App.Locals;
    const allDefinitions = await propertyService.listCustomProperties(ctx, 'pos.catalog');
    const catalog = await formulaService.loadFormulaCatalog(
      locals,
      ctx,
      'pos.catalog',
      allDefinitions,
    );
    const target = catalog.definitions.find((definition) => definition.id === installed.id);
    if (!target || target.rules.type !== 'formula') throw new Error('margin_formula_unavailable');
    const sellables = await posService.listSellables(ctx, { includeInactive: true });
    const candidateIds = sellables.map((row) => row.productId);
    const access = await entityService.authorizeCustomPropertyRecords(
      locals,
      ctx,
      'pos.catalog',
      candidateIds,
      'view',
    );
    const recordIds = candidateIds.filter((id) => access[id]);
    const values = await propertyService.readCustomPropertyValues(
      ctx,
      'pos.catalog',
      recordIds,
      catalog.definitions,
    );
    const inputs = await formulaService.loadFormulaInputs(ctx, 'pos.catalog', recordIds, values);
    const prerequisites = catalog.definitions.filter(
      (definition) => definition.rules.type === 'formula' && definition.id !== target.id,
    );
    const evaluated = await formulaService.evaluateFormulaDefinitions(
      ctx,
      [...prerequisites, target],
      catalog.fields,
      inputs,
    );

    const counts = {
      authorized: recordIds.length,
      match: 0,
      different: 0,
      blank: 0,
      partial: 0,
      error: 0,
    };
    for (const recordId of recordIds) {
      const cell = evaluated.cells[recordId]?.[target.id];
      const quality = cell?.formula?.quality ?? 'error';
      if (quality === 'blank') counts.blank++;
      else if (quality === 'partial') counts.partial++;
      else if (quality === 'error' || quality === 'restricted') counts.error++;
      else {
        const comparison = formulaService.nativeMarginComparison(
          cell?.value ?? null,
          inputs[recordId]?.[formulaService.POS_FORMULA_SOURCE_IDS.nativeMargin],
        );
        if (comparison.status === 'match') counts.match++;
        else if (comparison.status === 'different') counts.different++;
        else counts.blank++;
      }
    }
    console.log(
      JSON.stringify({
        outcome: 'compared',
        orgSlug: org.slug,
        formulaDefinitionId: installed.id,
        candidateRows: candidateIds.length,
        ...counts,
      }),
    );
  } finally {
    await Promise.allSettled([vite.close(), db.end()]);
  }
}

if (import.meta.main) await main();
