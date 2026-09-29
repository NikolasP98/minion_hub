#!/usr/bin/env bun
/** HTTP qualification for formula-variable columns against seeded loopback QA only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnvFile } from './snapshot-env';
import { matrixUuid, personaEmail, QA_PASSWORD } from './seed/ids';
import type {
  CustomPropertyBundle,
  CustomPropertyDefinition,
} from '../../src/lib/tables/custom-properties';
import type {
  FormulaDraftRulesV2,
  FormulaPreviewResponse,
  FormulaRulesV2,
} from '../../src/lib/tables/formula/contracts';
import type {
  ColumnNumberFormat,
  ColumnPresentationV2,
} from '../../src/lib/tables/column-presentation';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5199';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback QA only');
const qa = parseEnvFile(readFileSync('.env.qa.local', 'utf8'));
const tableId = 'pos.catalog';
const recordId = matrixUuid('formula.margin.product-price-100');
const runId = crypto.randomUUID().slice(0, 8);
const createdIds: string[] = [];
const checks: string[] = [];
let legacyAId: string | null = null;
let legacyBId: string | null = null;

const moneyFormat: ColumnNumberFormat = {
  style: 'currency',
  decimals: 2,
  currencyDisplay: 'symbol',
  percentScale: 'whole',
};
const ratioFormat: ColumnNumberFormat = {
  style: 'percent',
  decimals: 1,
  currencyDisplay: 'symbol',
  percentScale: 'ratio',
};

class Client {
  cookies = new Map<string, string>();

  async request(path: string, method = 'GET', body?: unknown, expected = 200): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        origin: base,
        'content-type': 'application/json',
        cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index >= 0) this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  async login(persona: string): Promise<void> {
    await this.request('/api/auth/password-login', 'POST', {
      identifier: persona.includes('@') ? persona : personaEmail(`tenancy.user.${persona}`),
      password: qa.QA_SEED_PASSWORD ?? QA_PASSWORD,
    });
  }
}

const owner = new Client();
const masked = new Client();

function passed(name: string): void {
  checks.push(name);
  console.log(`PASS ${name}`);
}

function variable(name: string | null, expression: string) {
  return { id: crypto.randomUUID(), name, expression };
}

function draft(rules: FormulaRulesV2): FormulaDraftRulesV2 {
  return {
    type: 'formula',
    version: 2,
    primaryVariableId: rules.primaryVariableId,
    variables: rules.variables.map(({ id, name, expression }) => ({ id, name, expression })),
  };
}

async function catalog(client = owner): Promise<{ revision: string }> {
  return (await client.request(`/api/tables/properties/formula/catalog?tableId=${tableId}`)) as {
    revision: string;
  };
}

async function list(client = owner): Promise<CustomPropertyDefinition[]> {
  return (
    (await client.request(`/api/tables/properties?tableId=${tableId}&includeArchived=1`)) as {
      definitions: CustomPropertyDefinition[];
    }
  ).definitions;
}

async function query(client = owner): Promise<CustomPropertyBundle> {
  return (await client.request('/api/tables/properties/values/query', 'POST', {
    tableId,
    recordIds: [recordId],
  })) as CustomPropertyBundle;
}

async function create(
  label: string,
  rules: unknown,
  presentation?: ColumnPresentationV2 | Record<string, unknown> | null,
): Promise<CustomPropertyDefinition> {
  const revision = (await catalog()).revision;
  const { definition } = (await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `Variable QA ${runId} ${label}`,
      rules,
      ...(presentation === undefined ? {} : { presentation }),
      hasDefault: false,
      catalogRevision: revision,
    },
    201,
  )) as { definition: CustomPropertyDefinition };
  createdIds.push(definition.id);
  return definition;
}

async function patch(
  client: Client,
  definition: CustomPropertyDefinition,
  body: Record<string, unknown>,
  expected = 200,
): Promise<CustomPropertyDefinition | null> {
  const response = (await client.request(
    `/api/tables/properties/${definition.id}`,
    'PATCH',
    { tableId, expectedVersion: definition.version, ...body },
    expected,
  )) as { definition?: CustomPropertyDefinition };
  if (response.definition) Object.assign(definition, response.definition);
  return response.definition ?? null;
}

async function archive(definition: CustomPropertyDefinition): Promise<void> {
  const result = (await owner.request(`/api/tables/properties/${definition.id}`, 'DELETE', {
    tableId,
    expectedVersion: definition.version,
  })) as { definition: CustomPropertyDefinition };
  Object.assign(definition, result.definition);
}

try {
  await owner.login('owner');
  await masked.login('presentation.persona.finance-masked-manager@qa.minion.test');

  const margin = variable('Margin', 'ROUND("Sale price" - "Estimated unit cost", 2)');
  const ratio = variable(
    'Margin ratio',
    'ROUND(("Sale price" - "Estimated unit cost") / NULLIF("Sale price", "Sale price" * 0), 4)',
  );
  const rules: FormulaDraftRulesV2 = {
    type: 'formula',
    version: 2,
    primaryVariableId: margin.id,
    variables: [margin, ratio],
  };
  const presentation: ColumnPresentationV2 = {
    version: 2,
    variables: [
      { variableId: margin.id, number: moneyFormat, tone: 'sign', emphasis: 'normal' },
      { variableId: ratio.id, number: ratioFormat, tone: 'none', emphasis: 'muted' },
    ],
  };
  const revision = (await catalog()).revision;
  const preview = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    rules,
    presentation,
    recordIds: [recordId],
    catalogRevision: revision,
  })) as FormulaPreviewResponse;
  assert.equal(preview.diagnostics.length, 0);
  assert.deepEqual(
    preview.variables?.map(({ variableId }) => variableId),
    [margin.id, ratio.id],
  );
  assert.deepEqual(
    preview.rows[0]?.variables?.map(({ value }) => value),
    [60, 0.6],
  );
  assert.equal(preview.rows[0]?.result.value, 60);
  passed('v2 preview returns ordered variables and stable primary scalar');

  const beforeCompositeCount = (await list()).length;
  const composite = await create('Composite margin', rules, presentation);
  assert.equal((await list()).length, beforeCompositeCount + 1);
  assert.equal(composite.rules.type, 'formula');
  assert('version' in composite.rules && composite.rules.version === 2);
  let bundle = await query();
  let cell = bundle.values[recordId]?.[composite.id];
  assert(cell?.formulaVariables);
  assert.deepEqual(
    cell.formulaVariables.map(({ variableId }) => variableId),
    [margin.id, ratio.id],
  );
  assert.deepEqual(
    cell.formulaVariables.map(({ value }) => value),
    [60, 0.6],
  );
  assert.equal(cell.effectiveValue, 60);
  assert.deepEqual(
    bundle.definitions.find(({ id }) => id === composite.id)?.presentation,
    presentation,
  );
  passed('v2 create persists and reloads both outputs and presentation');

  const compiled = composite.rules as FormulaRulesV2;
  const reordered: FormulaDraftRulesV2 = {
    ...draft(compiled),
    variables: [
      { ...draft(compiled).variables[1], name: 'Ratio renamed' },
      { ...draft(compiled).variables[0], name: 'Margin renamed' },
    ],
  };
  const reorderedPresentation: ColumnPresentationV2 = {
    version: 2,
    variables: [
      {
        variableId: ratio.id,
        number: { ...ratioFormat, decimals: 2 },
        tone: 'none',
        emphasis: 'normal',
      },
      {
        variableId: margin.id,
        number: { ...moneyFormat, decimals: 1 },
        tone: 'sign',
        emphasis: 'muted',
      },
    ],
  };
  const beforeReorderVersion = composite.version;
  await patch(owner, composite, {
    rules: reordered,
    presentation: reorderedPresentation,
    catalogRevision: (await catalog()).revision,
  });
  bundle = await query();
  cell = bundle.values[recordId]?.[composite.id];
  assert.deepEqual(
    cell?.formulaVariables?.map(({ variableId }) => variableId),
    [ratio.id, margin.id],
  );
  assert.deepEqual(
    cell?.formulaVariables?.map(({ name }) => name),
    ['Ratio renamed', 'Margin renamed'],
  );
  assert.equal(cell?.effectiveValue, 60);
  assert.equal((composite.rules as FormulaRulesV2).primaryVariableId, margin.id);
  assert.deepEqual(composite.presentation, reorderedPresentation);
  await owner.request(
    `/api/tables/properties/${composite.id}`,
    'PATCH',
    {
      tableId,
      expectedVersion: beforeReorderVersion,
      description: 'stale write must fail',
    },
    409,
  );
  passed('identity-preserving rename/reorder keeps primary and rejects stale CAS');

  const staleRevision = (await catalog()).revision;
  await patch(owner, composite, { description: 'advance catalog revision' });
  await owner.request(
    `/api/tables/properties/${composite.id}`,
    'PATCH',
    {
      tableId,
      expectedVersion: composite.version,
      rules: draft(composite.rules as FormulaRulesV2),
      catalogRevision: staleRevision,
    },
    409,
  );
  passed('stale catalog revision rejects a coherent-looking v2 snapshot');

  const duplicateA = variable('Ｒａｔｉｏ', '1');
  const duplicateB = variable('ratio', '2');
  await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `Variable QA ${runId} duplicate names`,
      rules: {
        type: 'formula',
        version: 2,
        primaryVariableId: duplicateA.id,
        variables: [duplicateA, duplicateB],
      },
      hasDefault: false,
      catalogRevision: (await catalog()).revision,
    },
    422,
  );
  const invalidType = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    rules: {
      type: 'formula',
      version: 2,
      primaryVariableId: duplicateA.id,
      variables: [
        { ...duplicateA, name: 'Invalid arithmetic', expression: '1 + TRUE' },
        { ...duplicateB, name: 'Valid companion' },
      ],
    },
    recordIds: [recordId],
    catalogRevision: (await catalog()).revision,
  })) as FormulaPreviewResponse;
  assert(invalidType.diagnostics.length > 0);
  assert(
    invalidType.variables?.some(
      ({ variableId, diagnostics }) => variableId === duplicateA.id && diagnostics.length,
    ),
  );
  assert.equal(invalidType.rows.length, 0);
  passed('normalized duplicate names and per-variable formula type errors fail closed');

  const publicPrimary = variable('Public total', '"Sale price" * 2');
  const restrictedAuxiliary = variable('Private margin', '"Sale price" - "Estimated unit cost"');
  const protectedComposite = await create('Protected composite', {
    type: 'formula',
    version: 2,
    primaryVariableId: publicPrimary.id,
    variables: [publicPrimary, restrictedAuxiliary],
  });
  const maskedDefinitions = await list(masked);
  const maskedProjection = maskedDefinitions.find(({ id }) => id === protectedComposite.id);
  assert(maskedProjection?.variablesRestricted);
  assert.equal(maskedProjection.rules.type, 'formula');
  assert('version' in maskedProjection.rules && maskedProjection.rules.version === 2);
  assert.deepEqual(
    (maskedProjection.rules as FormulaRulesV2).variables.map(({ id }) => id),
    [publicPrimary.id],
  );
  const maskedBundle = await query(masked);
  assert.equal(maskedBundle.values[recordId]?.[protectedComposite.id]?.effectiveValue, 200);
  assert.deepEqual(
    maskedBundle.values[recordId]?.[protectedComposite.id]?.formulaVariables?.map(
      ({ variableId }) => variableId,
    ),
    [publicPrimary.id],
  );
  const maskedJson = JSON.stringify({ definitions: maskedDefinitions, bundle: maskedBundle });
  assert(!maskedJson.includes(restrictedAuxiliary.id));
  assert(!maskedJson.includes(restrictedAuxiliary.name!));
  const maskedMetadataResponse = await patch(masked, maskedProjection, {
    description: 'masked metadata update preserves variables',
  });
  assert(maskedMetadataResponse);
  assert(!JSON.stringify(maskedMetadataResponse).includes(restrictedAuxiliary.id));
  assert(!JSON.stringify(maskedMetadataResponse).includes(restrictedAuxiliary.name!));
  const maskedCatalogRevision = (await catalog(masked)).revision;
  await patch(
    masked,
    maskedProjection,
    {
      rules: draft(maskedProjection.rules as FormulaRulesV2),
      catalogRevision: maskedCatalogRevision,
    },
    422,
  );
  await patch(
    masked,
    maskedProjection,
    { presentation: null, catalogRevision: maskedCatalogRevision },
    422,
  );
  const maskedCatalogJson = JSON.stringify(await catalog(masked));
  assert(!maskedCatalogJson.includes(restrictedAuxiliary.id));
  assert(!maskedCatalogJson.includes(restrictedAuxiliary.name!));
  const canonicalProtected = (await list()).find(({ id }) => id === protectedComposite.id)!;
  assert.deepEqual(
    (canonicalProtected.rules as FormulaRulesV2).variables.map(({ id }) => id),
    [publicPrimary.id, restrictedAuxiliary.id],
  );
  Object.assign(protectedComposite, canonicalProtected);
  passed(
    'masked non-primary redaction leaks no ID/name and metadata omission preserves canonical rules',
  );

  const legacyA = await create('Legacy A', { type: 'formula', expression: '"Sale price"' });
  legacyAId = legacyA.id;
  const legacyB = await create('Legacy B', {
    type: 'formula',
    expression: `"${legacyA.label}" * 2`,
  });
  legacyBId = legacyB.id;
  const legacyPresentation = {
    version: 1,
    number: moneyFormat,
    tone: 'none',
    secondary: { propertyId: legacyB.id, format: moneyFormat },
  };
  await patch(owner, legacyA, {
    presentation: legacyPresentation,
    catalogRevision: (await catalog()).revision,
  });
  const projectedLegacy = (await list()).find(({ id }) => id === legacyA.id)!;
  assert.equal(projectedLegacy.formulaEditor?.state, 'ready');
  if (projectedLegacy.formulaEditor?.state !== 'ready')
    throw new Error('legacy adapter unavailable');
  const adaptedIdsBeforeRename = projectedLegacy.formulaEditor.rules.variables.map(({ id }) => id);
  await patch(owner, legacyB, { label: `${legacyB.label} renamed` });
  const projectedAfterRename = (await list()).find(({ id }) => id === legacyA.id)!;
  assert.equal(projectedAfterRename.formulaEditor?.state, 'ready');
  if (projectedAfterRename.formulaEditor?.state !== 'ready')
    throw new Error('legacy adapter unavailable after secondary rename');
  assert.deepEqual(
    projectedAfterRename.formulaEditor.rules.variables.map(({ id }) => id),
    adaptedIdsBeforeRename,
  );
  await patch(owner, legacyA, {
    rules: projectedAfterRename.formulaEditor.rules,
    presentation: projectedAfterRename.formulaEditor.presentation,
    catalogRevision: (await catalog()).revision,
  });
  assert('version' in legacyA.rules && legacyA.rules.version === 2);
  const convertedCell = (await query()).values[recordId]?.[legacyA.id];
  assert.equal(convertedCell?.effectiveValue, 100);
  assert.deepEqual(
    convertedCell?.formulaVariables?.map(({ value }) => value),
    [100, 200],
  );
  passed('legacy A caption B converts when B primary depends on A primary');

  // Remove the auxiliary reference before archiving B, whose primary depends on A.
  const convertedRules = legacyA.rules as FormulaRulesV2;
  const primaryOnly: FormulaDraftRulesV2 = {
    type: 'formula',
    version: 2,
    primaryVariableId: convertedRules.primaryVariableId,
    variables: [
      {
        ...draft(convertedRules).variables.find(
          ({ id }) => id === convertedRules.primaryVariableId,
        )!,
        name: null,
      },
    ],
  };
  const primaryPresentation = legacyA.presentation as ColumnPresentationV2;
  await patch(owner, legacyA, {
    rules: primaryOnly,
    presentation: {
      version: 2,
      variables: primaryPresentation.variables.filter(
        ({ variableId }) => variableId === convertedRules.primaryVariableId,
      ),
    },
    catalogRevision: (await catalog()).revision,
  });
  await archive(legacyB);
  await archive(legacyA);

  console.log(`PASS ${checks.length} formula-variable HTTP groups`);
} finally {
  let definitions = await list().catch(() => []);
  let cleanupFailure: unknown = null;
  const currentLegacyA = definitions.find(({ id }) => id === legacyAId);
  const currentLegacyB = definitions.find(({ id }) => id === legacyBId);
  if (
    currentLegacyA &&
    !currentLegacyA.archivedAt &&
    currentLegacyA.rules.type === 'formula' &&
    'version' in currentLegacyA.rules &&
    currentLegacyA.rules.version === 2 &&
    currentLegacyA.rules.variables.length > 1 &&
    currentLegacyB &&
    !currentLegacyB.archivedAt
  ) {
    try {
      const currentRules = currentLegacyA.rules;
      const primary = draft(currentRules).variables.find(
        ({ id }) => id === currentRules.primaryVariableId,
      );
      assert(primary, 'converted legacy primary variable missing during cleanup');
      const currentPresentation =
        currentLegacyA.presentation?.version === 2 ? currentLegacyA.presentation : null;
      await patch(owner, currentLegacyA, {
        rules: {
          type: 'formula',
          version: 2,
          primaryVariableId: currentRules.primaryVariableId,
          variables: [{ ...primary, name: null }],
        },
        presentation: currentPresentation
          ? {
              version: 2,
              variables: currentPresentation.variables.filter(
                ({ variableId }) => variableId === currentRules.primaryVariableId,
              ),
            }
          : null,
        catalogRevision: (await catalog()).revision,
      });
      definitions = await list();
    } catch (error) {
      cleanupFailure = error;
      console.error('Cleanup failed while removing the synthetic legacy auxiliary dependency');
    }
  }
  for (const id of [...createdIds].reverse()) {
    const current = definitions.find((definition) => definition.id === id);
    if (!current || current.archivedAt) continue;
    try {
      await archive(current);
    } catch (error) {
      cleanupFailure ??= error;
      console.error(`Cleanup failed for synthetic QA property ${id}`);
    }
  }
  if (cleanupFailure) throw cleanupFailure;
}
