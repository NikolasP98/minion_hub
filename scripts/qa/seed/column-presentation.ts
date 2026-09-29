import type { SeedContext } from './db';
import { ensureSeededPersonalAgent, findOrCreateGoTrueUser, ORG_BUSINESS } from './tenancy';
import { matrixUuid, personaEmail, QA_PASSWORD } from './ids';
import { analyzeFormula, FORMULA_LANGUAGE_VERSION } from '../../../src/lib/tables/formula';
import { columnPresentationSchema } from '../../../src/lib/tables/column-presentation';

export const PRESENTATION_MASKED_MANAGER = matrixUuid(
  'presentation.persona.finance-masked-manager',
);
export const PRESENTATION_MASKED_MANAGER_ROLE = 'presentation-masked-manager';
export const PRESENTATION_PRIMARY = matrixUuid('presentation.formula.primary');
export const PRESENTATION_SECONDARY = matrixUuid('presentation.formula.secondary');

function formulaRules(expression: string) {
  const analysis = analyzeFormula(expression, []);
  if (analysis.diagnostics.length || !analysis.ast || !analysis.outputType)
    throw new Error(`invalid presentation seed formula: ${analysis.diagnostics[0]?.code}`);
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
  const email = personaEmail('presentation.persona.finance-masked-manager');
  const profileId = await findOrCreateGoTrueUser(
    ctx.admin,
    PRESENTATION_MASKED_MANAGER,
    email,
    QA_PASSWORD,
    { full_name: 'presentation.persona.finance-masked-manager' },
  );
  await ctx.sql`
    insert into profiles (id, email, display_name, role, account_type)
    values (${profileId}, ${email}, 'Presentation masked manager', 'user', 'person')
    on conflict (id) do update set email = excluded.email, display_name = excluded.display_name
  `;
  await ctx.sql`
    insert into organization_members (organization_id, profile_id, role)
    values (${ORG_BUSINESS}, ${profileId}, 'member')
    on conflict (organization_id, profile_id) do update set role = excluded.role
  `;
  await ctx.sql`
    insert into org_roles (org_id, key, name, rank, source_role_key, created_by)
    values (${ORG_BUSINESS}, ${PRESENTATION_MASKED_MANAGER_ROLE}, 'Presentation masked manager', 30, 'manager', ${profileId})
    on conflict (org_id, key) do update set name = excluded.name, source_role_key = excluded.source_role_key
  `;
  await ctx.sql`
    insert into member_roles (org_id, profile_id, role_key)
    values (${ORG_BUSINESS}, ${profileId}, ${PRESENTATION_MASKED_MANAGER_ROLE})
    on conflict (org_id, profile_id, role_key) do nothing
  `;
  await ensureSeededPersonalAgent(ctx, {
    profileId,
    agentId: `personal-${profileId}`,
    displayName: 'Presentation masked manager agent',
  });
  ctx.register('presentation.persona.finance-masked-manager-agent', {
    table: 'personal_agents',
    where: { profile_id: profileId, provisioning_status: 'active' },
  });
  await ctx.sql`
    insert into permission_rules
      (org_id, role_key, module, can_view, can_create, can_edit, can_delete,
       can_export, can_manage, if_owner, field_level)
    values
      (${ORG_BUSINESS}, ${PRESENTATION_MASKED_MANAGER_ROLE}, 'pos', true, true, true, true, true, true, false, 3),
      (${ORG_BUSINESS}, ${PRESENTATION_MASKED_MANAGER_ROLE}, 'finance', true, false, false, false, false, false, false, 0)
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
  ctx.register('presentation.persona.finance-masked-manager', {
    table: 'profiles',
    where: { id: profileId, email },
  });
  ctx.register('presentation.permission.pos-manager', {
    table: 'permission_rules',
    where: {
      org_id: ORG_BUSINESS,
      role_key: PRESENTATION_MASKED_MANAGER_ROLE,
      module: 'pos',
      can_manage: true,
    },
  });
  ctx.register('presentation.permission.finance-masked', {
    table: 'permission_rules',
    where: {
      org_id: ORG_BUSINESS,
      role_key: PRESENTATION_MASKED_MANAGER_ROLE,
      module: 'finance',
      field_level: 0,
    },
  });

  const numberFormat = {
    style: 'decimal' as const,
    decimals: 2,
    currencyDisplay: 'symbol' as const,
    percentScale: 'whole' as const,
  };
  const presentation = columnPresentationSchema.parse({
    version: 1,
    number: numberFormat,
    tone: 'sign',
    secondary: {
      propertyId: PRESENTATION_SECONDARY,
      format: { ...numberFormat, style: 'percent', decimals: 1, percentScale: 'ratio' },
    },
  });
  const formulaFixtures = [
    {
      id: PRESENTATION_PRIMARY,
      matrixId: 'presentation.formula.primary',
      label: 'QA Presented total',
      rules: formulaRules('10.25'),
      presentation,
    },
    {
      id: PRESENTATION_SECONDARY,
      matrixId: 'presentation.formula.secondary',
      label: 'QA Presented ratio',
      rules: formulaRules('0.2'),
      presentation: null,
    },
  ] as const;
  for (const fixture of formulaFixtures) {
    await ctx.sql`
      insert into app_table_properties
        (id, org_id, table_id, label, description, rules, presentation,
         has_default, default_value, version, created_by, updated_by)
      values
        (${fixture.id}, ${ORG_BUSINESS}, 'stock.items', ${fixture.label},
         'Deterministic calculated-column presentation fixture', ${ctx.sql.json(fixture.rules)},
         ${fixture.presentation == null ? null : ctx.sql.json(fixture.presentation)},
         0, null, 1, ${profileId}, ${profileId})
      on conflict (org_id, id) do update set
        table_id = excluded.table_id,
        label = excluded.label,
        description = excluded.description,
        rules = excluded.rules,
        presentation = excluded.presentation,
        updated_by = excluded.updated_by
    `;
    ctx.register(fixture.matrixId, {
      table: 'app_table_properties',
      where: { org_id: ORG_BUSINESS, id: fixture.id, table_id: 'stock.items' },
    });
  }
}
