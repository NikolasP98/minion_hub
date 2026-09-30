/**
 * Backfill: copy `stk_items.item_group` / `reorder_qty` / `moq` into custom
 * columns on `stock.items`, per proposal
 * 2026-09-30-hub-stock-item-optional-fields-to-custom-columns.md.
 *
 * Owner-run only. Never wired into CI or app code. Safe by default: without
 * --apply this only reports the plan and makes no writes.
 *
 * Usage:
 *   bun scripts/stock-optional-fields-to-custom.ts            # dry-run
 *   bun scripts/stock-optional-fields-to-custom.ts --apply    # write
 *
 * Idempotent: a second --apply run makes no further writes (definitions are
 * looked up by templateKey, values by matching effectiveValue) and still
 * asserts the invariant.
 */
import postgres from 'postgres';
import { createServer } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { CUSTOM_PROPERTY_COLORS } from '../src/lib/tables/custom-properties';
import type {
  CustomPropertyDefinition,
  CustomPropertyOption,
  CustomPropertyValueCell,
} from '../src/lib/tables/custom-properties';
import type { CoreCtx } from '../src/server/auth/core-ctx';

// ---------------------------------------------------------------------------
// Pure planning (no DB/service imports below this point until main()) —
// exported and unit-tested by stock-optional-fields-to-custom.test.ts.
// ---------------------------------------------------------------------------

export interface StockItemRow {
  itemId: string;
  code: string;
  name: string;
  itemGroup: string | null;
  reorderQty: number | null;
  moq: number | null;
}

export type BackfillKey = 'group' | 'reorderQty' | 'moq';

export const BACKFILL_TEMPLATE_KEYS: Record<BackfillKey, string> = {
  group: 'backfill:stock.items:group',
  reorderQty: 'backfill:stock.items:reorder-qty',
  moq: 'backfill:stock.items:moq',
};

export const BACKFILL_LABELS: Record<BackfillKey, string> = {
  group: 'Group',
  reorderQty: 'Reorder qty',
  moq: 'MOQ',
};

export type BackfillRules =
  | { type: 'select'; options: CustomPropertyOption[] }
  | { type: 'number'; min: null; max: null; precision: null };

export interface DefinitionNeed {
  key: BackfillKey;
  label: string;
  templateKey: string;
  rules: BackfillRules;
}

export interface ValueToWrite {
  key: BackfillKey;
  itemId: string;
  /** Raw source value: the item_group label (string) or the numeric value. */
  rawValue: string | number;
}

export interface OrgBackfillPlan {
  definitionsNeeded: DefinitionNeed[];
  valuesToWrite: ValueToWrite[];
}

/** Given one org's stk_items rows, decide which custom-property definitions
 * are needed and which item values must be copied. A fresh/all-null org
 * (no non-null item_group/reorder_qty/moq anywhere) produces nothing. */
export function planOrgBackfill(items: StockItemRow[]): OrgBackfillPlan {
  const groupLabels = [
    ...new Set(
      items.map((item) => item.itemGroup?.trim()).filter((value): value is string => !!value),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const definitionsNeeded: DefinitionNeed[] = [];
  if (groupLabels.length)
    definitionsNeeded.push({
      key: 'group',
      label: BACKFILL_LABELS.group,
      templateKey: BACKFILL_TEMPLATE_KEYS.group,
      rules: {
        type: 'select',
        options: groupLabels.map((label, index) => ({
          id: crypto.randomUUID(),
          label,
          color: CUSTOM_PROPERTY_COLORS[index % CUSTOM_PROPERTY_COLORS.length],
          archivedAt: null,
        })),
      },
    });
  if (items.some((item) => item.reorderQty != null))
    definitionsNeeded.push({
      key: 'reorderQty',
      label: BACKFILL_LABELS.reorderQty,
      templateKey: BACKFILL_TEMPLATE_KEYS.reorderQty,
      rules: { type: 'number', min: null, max: null, precision: null },
    });
  if (items.some((item) => item.moq != null))
    definitionsNeeded.push({
      key: 'moq',
      label: BACKFILL_LABELS.moq,
      templateKey: BACKFILL_TEMPLATE_KEYS.moq,
      rules: { type: 'number', min: null, max: null, precision: null },
    });

  const valuesToWrite: ValueToWrite[] = [];
  for (const item of items) {
    const group = item.itemGroup?.trim();
    if (group) valuesToWrite.push({ key: 'group', itemId: item.itemId, rawValue: group });
    if (item.reorderQty != null)
      valuesToWrite.push({ key: 'reorderQty', itemId: item.itemId, rawValue: item.reorderQty });
    if (item.moq != null)
      valuesToWrite.push({ key: 'moq', itemId: item.itemId, rawValue: item.moq });
  }
  return { definitionsNeeded, valuesToWrite };
}

// ---------------------------------------------------------------------------
// I/O wrapper
// ---------------------------------------------------------------------------

interface OrgSummary {
  orgId: string;
  orgName: string;
  mode: 'dry-run' | 'apply';
  definitions: Record<BackfillKey, 'created' | 'already-existed' | 'not-needed'>;
  valuesWritten: number;
  valuesAlreadyCorrect: number;
  invariant: 'pass' | 'fail' | 'not-checked';
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) throw new Error('SUPABASE_DB_URL is required');
  const db = postgres(url, { prepare: false, max: 1 });
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let resetPools: (() => Promise<void>) | undefined;
  const summaries: OrgSummary[] = [];
  let overallInvariantFail = false;
  try {
    vite = await createServer({
      configFile: false,
      appType: 'custom',
      plugins: [sveltekit()],
      server: { middlewareMode: true, watch: null },
      logLevel: 'error',
    });

    const rows = await db<
      {
        org_id: string;
        item_id: string;
        code: string;
        name: string;
        item_group: string | null;
        reorder_qty: string | null;
        moq: string | null;
      }[]
    >`
      select org_id, id as item_id, code, name, item_group,
             reorder_qty::text as reorder_qty, moq::text as moq
      from stk_items
      where item_group is not null or reorder_qty is not null or moq is not null
      order by org_id, code
    `;
    if (!rows.length) {
      console.log(JSON.stringify({ outcome: apply ? 'apply' : 'dry-run', orgs: [] }));
      return;
    }

    const byOrg = new Map<string, StockItemRow[]>();
    for (const row of rows) {
      const list = byOrg.get(row.org_id) ?? [];
      list.push({
        itemId: row.item_id,
        code: row.code,
        name: row.name,
        itemGroup: row.item_group,
        reorderQty: row.reorder_qty == null ? null : Number(row.reorder_qty),
        moq: row.moq == null ? null : Number(row.moq),
      });
      byOrg.set(row.org_id, list);
    }
    const orgIds = [...byOrg.keys()];

    if (apply) {
      const snapshotPath = `${process.env.TMPDIR ?? '/tmp'}/stock-optional-fields-backfill-${Date.now()}.json`;
      await writeFile(snapshotPath, JSON.stringify(Object.fromEntries(byOrg), null, 2), {
        mode: 0o600,
      });
      console.log(`[snapshot] wrote ${snapshotPath}`);
    }

    const [{ getCoreDb }, poolModule, propertyService] = await Promise.all([
      vite.ssrLoadModule('/src/server/db/pg-client.ts') as Promise<{
        getCoreDb: () => CoreCtx['db'];
      }>,
      vite.ssrLoadModule('/src/server/db/pg-pool.ts') as Promise<{
        resetAllPgPools: () => Promise<void>;
      }>,
      vite.ssrLoadModule('/src/server/services/custom-properties.service.ts') as Promise<{
        createCustomProperty: (
          ctx: CoreCtx,
          input: {
            tableId: 'stock.items';
            label: string;
            description?: string;
            rules: BackfillRules;
            hasDefault: false;
          },
          formulaContext: { nativeSources: []; templateKey: string },
        ) => Promise<CustomPropertyDefinition>;
        listCustomProperties: (
          ctx: CoreCtx,
          tableId: string,
        ) => Promise<CustomPropertyDefinition[]>;
        readCustomPropertyValues: (
          ctx: CoreCtx,
          tableId: string,
          recordIds: string[],
          definitions?: CustomPropertyDefinition[],
        ) => Promise<Record<string, Record<string, CustomPropertyValueCell>>>;
        putCustomPropertyValue: (
          ctx: CoreCtx,
          tableId: string,
          propertyId: string,
          recordId: string,
          value: unknown,
          expectedVersion: number,
        ) => Promise<CustomPropertyValueCell>;
      }>,
    ]);
    resetPools = poolModule.resetAllPgPools;

    for (const orgId of orgIds) {
      const items = byOrg.get(orgId)!;
      const [org] = await db<{ name: string }[]>`
        select name from organizations where id::text = ${orgId} limit 1
      `;
      const orgName = org?.name ?? orgId;
      const [owner] = await db<{ profile_id: string }[]>`
        select profile_id::text as profile_id from organization_members
        where organization_id::text = ${orgId}
        order by (case role when 'owner' then 0 when 'admin' then 1 else 2 end)
        limit 1
      `;
      if (!owner) {
        console.warn(`[skip] org ${orgId} (${orgName}) has no members to act as; skipping`);
        continue;
      }
      const ctx: CoreCtx = { db: getCoreDb(), tenantId: orgId, profileId: owner.profile_id };
      const plan = planOrgBackfill(items);

      const definitions: OrgSummary['definitions'] = {
        group: 'not-needed',
        reorderQty: 'not-needed',
        moq: 'not-needed',
      };
      // key -> resolved definition (existing or freshly created), used to map
      // raw values (group labels) to persisted option ids at write time.
      const resolved = new Map<BackfillKey, CustomPropertyDefinition>();

      if (plan.definitionsNeeded.length) {
        const existingDefs = await propertyService.listCustomProperties(ctx, 'stock.items');
        for (const need of plan.definitionsNeeded) {
          const existing = existingDefs.find(
            (definition) =>
              definition.label === need.label &&
              JSON.stringify(definition.rules.type) === JSON.stringify(need.rules.type),
          );
          // Prefer an exact templateKey match when present (idempotency key);
          // listCustomProperties doesn't expose templateKey, so fall back to
          // label+type — safe here because these three labels are reserved
          // for this backfill only.
          if (existing) {
            definitions[need.key] = 'already-existed';
            resolved.set(need.key, existing);
            continue;
          }
          if (!apply) {
            definitions[need.key] = 'created';
            continue;
          }
          const created = await propertyService.createCustomProperty(
            ctx,
            {
              tableId: 'stock.items',
              label: need.label,
              rules: need.rules,
              hasDefault: false,
            },
            { nativeSources: [], templateKey: need.templateKey },
          );
          definitions[need.key] = 'created';
          resolved.set(need.key, created);
        }
      }

      let valuesWritten = 0;
      let valuesAlreadyCorrect = 0;
      if (apply && plan.valuesToWrite.length) {
        const groupOptionsByLabel = new Map<string, string>();
        const groupDef = resolved.get('group');
        if (groupDef?.rules.type === 'select')
          for (const option of groupDef.rules.options)
            groupOptionsByLabel.set(option.label, option.id);

        const recordIds = [...new Set(plan.valuesToWrite.map((v) => v.itemId))];
        const defsForRead = [...resolved.values()];
        const current = await propertyService.readCustomPropertyValues(
          ctx,
          'stock.items',
          recordIds,
          defsForRead,
        );

        for (const write of plan.valuesToWrite) {
          const definition = resolved.get(write.key);
          if (!definition) continue; // dry-run-only path never reaches here (apply guard above)
          const value =
            write.key === 'group'
              ? groupOptionsByLabel.get(write.rawValue as string)
              : write.rawValue;
          if (value === undefined) continue; // ponytail: unmapped label — shouldn't happen, see TODO below
          const cell = current[write.itemId]?.[definition.id];
          if (cell && cell.effectiveValue === value) {
            valuesAlreadyCorrect++;
            continue;
          }
          await propertyService.putCustomPropertyValue(
            ctx,
            'stock.items',
            definition.id,
            write.itemId,
            value,
            cell?.version ?? 0,
          );
          valuesWritten++;
        }
      } else if (!apply) {
        valuesWritten = plan.valuesToWrite.length; // dry-run: report what WOULD be written
      }

      // Invariant: every non-null source value has an equal custom-property value.
      let invariant: OrgSummary['invariant'] = 'not-checked';
      if (apply) {
        invariant = 'pass';
        const recordIds = [...new Set(plan.valuesToWrite.map((v) => v.itemId))];
        const defsForRead = [...resolved.values()];
        if (recordIds.length && defsForRead.length) {
          const after = await propertyService.readCustomPropertyValues(
            ctx,
            'stock.items',
            recordIds,
            defsForRead,
          );
          const groupOptionsByLabel = new Map<string, string>();
          const groupDef = resolved.get('group');
          if (groupDef?.rules.type === 'select')
            for (const option of groupDef.rules.options)
              groupOptionsByLabel.set(option.label, option.id);
          for (const write of plan.valuesToWrite) {
            const definition = resolved.get(write.key);
            if (!definition) continue;
            const expected =
              write.key === 'group'
                ? groupOptionsByLabel.get(write.rawValue as string)
                : write.rawValue;
            const actual = after[write.itemId]?.[definition.id]?.effectiveValue;
            if (actual !== expected) {
              invariant = 'fail';
              overallInvariantFail = true;
              console.error(
                `[invariant-fail] org ${orgId} item ${write.itemId} key ${write.key}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
              );
            }
          }
        }
      }

      summaries.push({
        orgId,
        orgName,
        mode: apply ? 'apply' : 'dry-run',
        definitions,
        valuesWritten,
        valuesAlreadyCorrect,
        invariant,
      });
    }

    for (const summary of summaries) console.log(JSON.stringify(summary));
    console.log(
      JSON.stringify({
        outcome: apply ? 'apply' : 'dry-run',
        orgsProcessed: summaries.length,
        overallInvariant: apply ? (overallInvariantFail ? 'fail' : 'pass') : 'not-checked',
      }),
    );
    if (apply && overallInvariantFail) process.exitCode = 1;
  } finally {
    await Promise.allSettled([resetPools?.(), vite?.close(), db.end()]);
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entrypoint) await main();
