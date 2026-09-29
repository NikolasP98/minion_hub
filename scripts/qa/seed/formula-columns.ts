import type { SeedContext } from './db';
import { matrixUuid } from './ids';
import { personaEmail, QA_PASSWORD } from './ids';
import { ensureSeededPersonalAgent, findOrCreateGoTrueUser, ORG_BUSINESS } from './tenancy';
import { WH_DEFAULT } from './stock';

export const FORMULA_MARGIN_PRODUCT = matrixUuid('formula.margin.product-price-100');
export const FORMULA_MARGIN_ITEM = matrixUuid('formula.margin.stock-cost-40');
export const FORMULA_MASKED_PERSONA = matrixUuid('formula.persona.finance-masked');
export const FORMULA_MASKED_ROLE = 'formula-masked-viewer';

/** Complete, deterministic price/cost pair for native-vs-formula comparison. */
export async function seed(ctx: SeedContext): Promise<void> {
  const maskedEmail = personaEmail('formula.persona.finance-masked');
  const maskedProfileId = await findOrCreateGoTrueUser(
    ctx.admin,
    FORMULA_MASKED_PERSONA,
    maskedEmail,
    QA_PASSWORD,
    { full_name: 'formula.persona.finance-masked' },
  );
  await ctx.sql`
    insert into profiles (id, email, display_name, role, account_type)
    values (${maskedProfileId}, ${maskedEmail}, 'Formula masked viewer', 'user', 'person')
    on conflict (id) do update set email = excluded.email, display_name = excluded.display_name
  `;
  await ctx.sql`
    insert into organization_members (organization_id, profile_id, role)
    values (${ORG_BUSINESS}, ${maskedProfileId}, 'member')
    on conflict (organization_id, profile_id) do update set role = excluded.role
  `;
  await ctx.sql`
    insert into org_roles (org_id, key, name, rank, source_role_key, created_by)
    values (${ORG_BUSINESS}, ${FORMULA_MASKED_ROLE}, 'Formula masked viewer', 10, 'viewer', ${maskedProfileId})
    on conflict (org_id, key) do update set name = excluded.name, source_role_key = excluded.source_role_key
  `;
  await ctx.sql`
    insert into member_roles (org_id, profile_id, role_key)
    values (${ORG_BUSINESS}, ${maskedProfileId}, ${FORMULA_MASKED_ROLE})
    on conflict (org_id, profile_id, role_key) do nothing
  `;
  await ensureSeededPersonalAgent(ctx, {
    profileId: maskedProfileId,
    agentId: `personal-${maskedProfileId}`,
    displayName: 'Formula masked viewer agent',
  });
  ctx.register('formula.persona.finance-masked-agent', {
    table: 'personal_agents',
    where: { profile_id: maskedProfileId, provisioning_status: 'active' },
  });
  await ctx.sql`
    insert into permission_rules
      (org_id, role_key, module, can_view, can_create, can_edit, can_delete,
       can_export, can_manage, if_owner, field_level)
    values
      (${ORG_BUSINESS}, ${FORMULA_MASKED_ROLE}, 'pos', true, false, false, false, false, false, false, 0),
      (${ORG_BUSINESS}, ${FORMULA_MASKED_ROLE}, 'finance', true, false, false, false, false, false, false, 0)
    on conflict (org_id, role_key, module) do update set
      can_view = excluded.can_view,
      can_create = excluded.can_create,
      can_edit = excluded.can_edit,
      can_delete = excluded.can_delete,
      can_export = excluded.can_export,
      can_manage = excluded.can_manage,
      if_owner = excluded.if_owner,
      field_level = excluded.field_level
  `;
  ctx.register('formula.persona.finance-masked', {
    table: 'profiles',
    where: { id: maskedProfileId, email: maskedEmail },
  });
  ctx.register('formula.permission.finance-masked', {
    table: 'permission_rules',
    where: {
      org_id: ORG_BUSINESS,
      role_key: FORMULA_MASKED_ROLE,
      module: 'finance',
      field_level: 0,
    },
  });

  await ctx.sql`
    insert into fin_products (id, org_id, code, name, category, unit_price, active, metadata)
    values (
      ${FORMULA_MARGIN_PRODUCT}, ${ORG_BUSINESS}, 'FM100', 'QA Formula Margin',
      'product', 100.00, true, ${ctx.sql.json({ qaFixture: 'formula-margin-v1' })}
    )
    on conflict (org_id, code) do update set
      name = excluded.name,
      unit_price = excluded.unit_price,
      active = excluded.active,
      metadata = excluded.metadata
  `;
  ctx.register('formula.margin.product-price-100', {
    table: 'fin_products',
    where: { org_id: ORG_BUSINESS, id: FORMULA_MARGIN_PRODUCT, unit_price: 100 },
  });

  await ctx.sql`
    insert into stk_items (id, org_id, code, name, uom, fin_product_id)
    values (
      ${FORMULA_MARGIN_ITEM}, ${ORG_BUSINESS}, 'QA-FM40', 'QA Formula Margin Cost',
      'unit', ${FORMULA_MARGIN_PRODUCT}
    )
    on conflict (org_id, code) do update set
      name = excluded.name,
      uom = excluded.uom,
      fin_product_id = excluded.fin_product_id
  `;
  ctx.register('formula.margin.stock-cost-40', {
    table: 'stk_items',
    where: {
      org_id: ORG_BUSINESS,
      id: FORMULA_MARGIN_ITEM,
      fin_product_id: FORMULA_MARGIN_PRODUCT,
    },
  });

  await ctx.sql`
    insert into stk_bins (org_id, item_id, warehouse_id, qty, valuation_rate)
    values (${ORG_BUSINESS}, ${FORMULA_MARGIN_ITEM}, ${WH_DEFAULT}, 10, 40.00)
    on conflict (org_id, item_id, warehouse_id) do update set
      qty = excluded.qty,
      valuation_rate = excluded.valuation_rate
  `;
  ctx.register('formula.margin.bin-complete', {
    table: 'stk_bins',
    where: {
      org_id: ORG_BUSINESS,
      item_id: FORMULA_MARGIN_ITEM,
      warehouse_id: WH_DEFAULT,
      valuation_rate: 40,
    },
  });
}
