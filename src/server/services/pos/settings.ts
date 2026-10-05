import { eq } from 'drizzle-orm';
import type { EmissionDocType } from '$server/finance/emission';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { posSettings } from '$server/db/pg-pos-schema';
import {
  REQUIREMENT_KINDS as REQ_KINDS,
  isRequirementLevel,
  normalizeRequirements as reqNormalize,
  type PosRequirements as Reqs,
} from '$lib/pos/requirements';
import { seedShadowSeries } from '../pos-emission.service';
import { PosError } from './errors';
import {
  normalizePaymentMethods,
  paymentPolicyRevision,
  validatePaymentMethodsWrite,
  type PaymentMethodPolicy,
  type PaymentMethodWrite,
} from './credit-method-policy';
import { lockPosSettingsExclusive, lockPosSettingsShared } from './lock-key';
import { currencyReadPolicy, requirePosCurrency } from './money';

/**
 * POS settings normalization and admission. Every transaction-aware reader keeps
 * the caller's transaction and the settings lock it already owns.
 */
export type PaymentMethod = PaymentMethodPolicy;

/**
 * A ticket is submitted to SUNAT only when EVERY method it was paid with is
 * admissible: one non-admissible tender on a split payment keeps the whole
 * ticket out (a receipt cannot cover part of a sale). An unknown method id
 * (removed from settings after the sale) counts as admissible.
 */
export function emissionAllowedByMethods(
  methods: readonly Pick<PaymentMethod, 'id' | 'sunat'>[],
  payments: readonly { method: string }[],
): boolean {
  const byId = new Map(methods.map((m) => [m.id, m]));
  return payments.every((p) => byId.get(p.method)?.sunat !== false);
}

/**
 * `mode: 'shadow'` fires a real (zero-legal-effect) emission to SUNAT's beta
 * sandbox on every ticket, for pipeline validation ahead of a production
 * cutover. `'prod'` is DELIBERATELY not a member of this union — the value
 * doesn't exist yet (spec 2026-08-14-pos-shadow-emission-spec.md §1); a raw
 * string outside `EmissionSettings` is rejected by `validateEmission`.
 */
export interface EmissionSettings {
  mode: 'off' | 'shadow';
  docTypeDefault: EmissionDocType;
}

/** The requirement registry lives in `$lib/pos/requirements` (shared with the
 *  till and the settings page); re-exported so existing imports keep working. */
export {
  REQUIREMENT_LEVELS,
  REQUIREMENT_KINDS,
  REQUIREMENT_ERROR_CODE,
  normalizeRequirements,
  missingRequirements,
} from '$lib/pos/requirements';
export type { RequirementLevel, RequirementKind, PosRequirements } from '$lib/pos/requirements';

export interface PosSettings {
  methods: PaymentMethod[];
  currency: string;
  requireCustomer: boolean;
  allowPriceOverride: boolean;
  emission: EmissionSettings;
  requirements: Reqs;
}

/**
 * Accepts either shape a `pos_settings.methods` jsonb value may hold: the
 * legacy `string[]` (pre-2026-08-14 rows) or the current `PaymentMethod[]`.
 * A bare string `s` is upgraded to an object, guessing `takesTendered` from
 * the one legacy special-case — `'cash'` may appear as a literal HERE ONLY,
 * a one-time migration guess, never as branching logic elsewhere.
 */
export function normalizeMethods(raw: unknown): PaymentMethod[] {
  return normalizePaymentMethods(raw);
}

// Frozen (incl. the methods array, and each method object) so a stray
// in-place mutation throws instead of silently corrupting defaults for every
// org in the process.
export const DEFAULT_POS_SETTINGS: PosSettings = Object.freeze({
  methods: Object.freeze(
    [
      {
        id: 'cash',
        label: 'Efectivo',
        enabled: true,
        takesTendered: true,
        drawsOnCredit: false,
        requiresCreditDecision: false,
        documentDefault: null,
      },
      {
        id: 'card',
        label: 'Tarjeta',
        enabled: true,
        takesTendered: false,
        drawsOnCredit: false,
        requiresCreditDecision: false,
        documentDefault: null,
      },
      {
        id: 'yape',
        label: 'Yape',
        enabled: true,
        takesTendered: false,
        drawsOnCredit: false,
        requiresCreditDecision: false,
        documentDefault: null,
      },
      {
        id: 'plin',
        label: 'Plin',
        enabled: true,
        takesTendered: false,
        drawsOnCredit: false,
        requiresCreditDecision: false,
        documentDefault: null,
      },
      {
        id: 'transfer',
        label: 'Transferencia',
        enabled: true,
        takesTendered: false,
        drawsOnCredit: false,
        requiresCreditDecision: false,
        documentDefault: null,
      },
    ].map((m) => Object.freeze(m)),
  ) as PaymentMethod[],
  currency: 'PEN',
  requireCustomer: false,
  allowPriceOverride: true,
  emission: Object.freeze({ mode: 'off', docTypeDefault: '03' }) as EmissionSettings,
  requirements: Object.freeze(reqNormalize({})) as Reqs,
});

/** Tolerant of a row whose `emission` column predates this slice's migration
 *  default (shouldn't happen post-migration, but a stray legacy row or a hand
 *  edit is cheap to guard against). */
function normalizeEmission(raw: unknown): EmissionSettings {
  const r = raw as Partial<EmissionSettings> | null | undefined;
  return {
    mode: r?.mode === 'shadow' ? 'shadow' : 'off',
    docTypeDefault: r?.docTypeDefault === '01' ? '01' : '03',
  };
}

const normalizeRequirements = reqNormalize;

export interface PosSettingsRead extends PosSettings {
  currencyIssue: 'unsupported_pos_currency' | null;
  supportedCurrencies: readonly string[];
  paymentPolicyRevision: string;
}

type SettingsRow = typeof posSettings.$inferSelect;

function settingsRead(row?: SettingsRow | null): PosSettingsRead {
  const base: PosSettings = row
    ? {
        methods: normalizeMethods(row.methods),
        currency: row.currency,
        requireCustomer: row.requireCustomer,
        allowPriceOverride: row.allowPriceOverride,
        emission: normalizeEmission(row.emission),
        requirements: normalizeRequirements(row.requirements),
      }
    : {
        ...DEFAULT_POS_SETTINGS,
        methods: DEFAULT_POS_SETTINGS.methods.map((method) => ({ ...method })),
        emission: { ...DEFAULT_POS_SETTINGS.emission },
        requirements: { ...DEFAULT_POS_SETTINGS.requirements },
      };
  const read = { ...base, ...currencyReadPolicy(base.currency) };
  return { ...read, paymentPolicyRevision: paymentPolicyRevision(read) };
}

export async function getPosSettings(ctx: CoreCtx): Promise<PosSettingsRead> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.select().from(posSettings).where(eq(posSettings.orgId, ctx.tenantId)).limit(1),
  );
  return settingsRead(row);
}

export async function getPosSettingsInTx(
  tx: CoreTx,
  orgId: string,
  options: { lock?: boolean } = {},
): Promise<PosSettingsRead> {
  if (options.lock !== false) await lockPosSettingsShared(tx, orgId);
  const [row] = await tx.select().from(posSettings).where(eq(posSettings.orgId, orgId)).limit(1);
  return settingsRead(row);
}

/** Plan admission already owns a transaction; never acquire another pool connection there. */
export async function getPosCurrencyInTx(tx: CoreTx, orgId: string): Promise<string> {
  const [row] = await tx
    .select({ currency: posSettings.currency })
    .from(posSettings)
    .where(eq(posSettings.orgId, orgId))
    .limit(1);
  return row?.currency ?? DEFAULT_POS_SETTINGS.currency;
}

/** ids unique + non-empty lowercase, at least one enabled, surcharge >= 0. */
function validateMethods(methods: PaymentMethodWrite[]): void {
  validatePaymentMethodsWrite(methods);
}

/** `'prod'` (or anything else) is REJECTED here by construction — it's simply
 *  not one of the two branches, same as an unrecognised docTypeDefault. */
function validateEmission(emission: EmissionSettings): void {
  if (emission.mode !== 'off' && emission.mode !== 'shadow') {
    throw new PosError(`invalid emission mode ${String(emission.mode)}`, 'invalid_emission_mode');
  }
  if (emission.docTypeDefault !== '03' && emission.docTypeDefault !== '01') {
    throw new PosError(
      `invalid emission docTypeDefault ${String(emission.docTypeDefault)}`,
      'invalid_emission_doctype',
    );
  }
}

/** Unlike `normalizeRequirements` (used on READ, where a legacy/malformed row
 *  must degrade to 'off' rather than break the page), a WRITE with a bad
 *  shape should be rejected the same way `validateMethods`/`validateEmission`
 *  reject theirs — as a 400 PosError, not silently coerced then persisted,
 *  and never left to reach the DB layer unchecked. */
function validateRequirements(requirements: Partial<Reqs>): void {
  for (const k of REQ_KINDS) {
    if (requirements[k] !== undefined && !isRequirementLevel(requirements[k])) {
      throw new PosError(
        `invalid requirements.${k} ${String(requirements[k])}`,
        'invalid_requirements',
      );
    }
  }
}

/** A settings patch; `requirements` may name only the kinds it changes. */
export type PosSettingsPatch = Omit<Partial<PosSettings>, 'requirements' | 'methods'> & {
  methods?: PaymentMethodWrite[];
  requirements?: Partial<Reqs>;
};

export async function updatePosSettings(
  ctx: CoreCtx,
  patch: PosSettingsPatch,
): Promise<PosSettingsRead> {
  const row = await withOrgCore(ctx, async (tx) => {
    await lockPosSettingsExclusive(tx, ctx.tenantId);
    const [stored] = await tx
      .select()
      .from(posSettings)
      .where(eq(posSettings.orgId, ctx.tenantId))
      .limit(1);
    const current = settingsRead(stored);
    const { requirements: reqPatch, methods: methodPatch, ...rest } = patch;
    const methodsPresent = Object.hasOwn(patch, 'methods');
    if (methodsPresent) validateMethods(methodPatch as PaymentMethodWrite[]);
    const next: PosSettings = {
      ...current,
      ...rest,
      methods: methodsPresent ? normalizePaymentMethods(methodPatch) : current.methods,
    };
    next.currency = requirePosCurrency(next.currency);
    if (reqPatch) {
      validateRequirements(reqPatch);
      next.requirements = reqNormalize({ ...current.requirements, ...reqPatch });
    }
    validateEmission(next.emission);
    validateRequirements(next.requirements);
    next.requirements = normalizeRequirements(next.requirements);

    let updated: SettingsRow;
    if (!stored) {
      [updated] = await tx
        .insert(posSettings)
        .values({ orgId: ctx.tenantId, ...next })
        .returning();
    } else {
      const set: Partial<typeof posSettings.$inferInsert> = { updatedAt: new Date() };
      if (methodsPresent) set.methods = next.methods;
      if (Object.hasOwn(patch, 'currency')) set.currency = next.currency;
      if (Object.hasOwn(patch, 'requireCustomer')) set.requireCustomer = next.requireCustomer;
      if (Object.hasOwn(patch, 'allowPriceOverride'))
        set.allowPriceOverride = next.allowPriceOverride;
      if (Object.hasOwn(patch, 'emission')) set.emission = next.emission;
      if (Object.hasOwn(patch, 'requirements')) set.requirements = next.requirements;
      [updated] = await tx
        .update(posSettings)
        .set(set)
        .where(eq(posSettings.orgId, ctx.tenantId))
        .returning();
    }
    // Enabling shadow mode auto-seeds the beta series if absent (spec §2),
    // idempotently, in the SAME transaction as the settings write.
    if (next.emission.mode === 'shadow') await seedShadowSeries(tx, ctx.tenantId);
    return updated;
  });
  return settingsRead(row);
}
