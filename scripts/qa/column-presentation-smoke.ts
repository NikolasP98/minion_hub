#!/usr/bin/env bun
/** HTTP qualification of calculated-column presentation against seeded loopback QA. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnvFile } from './snapshot-env';
import { matrixUuid, personaEmail, QA_PASSWORD } from './seed/ids';
import type {
  CustomPropertyBundle,
  CustomPropertyDefinition,
} from '../../src/lib/tables/custom-properties';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5199';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback QA only');
const qa = parseEnvFile(readFileSync('.env.qa.local', 'utf8'));
const tableId = 'pos.catalog';
const recordId = matrixUuid('formula.margin.product-price-100');
const runId = crypto.randomUUID().slice(0, 8);
const created: CustomPropertyDefinition[] = [];
const checks: string[] = [];
const number = {
  style: 'currency',
  decimals: 2,
  currencyDisplay: 'symbol',
  percentScale: 'whole',
} as const;
const ratioFormat = {
  style: 'percent',
  decimals: 1,
  currencyDisplay: 'symbol',
  percentScale: 'ratio',
} as const;

class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, expected = 200): Promise<unknown> {
    if (body && typeof body === 'object') {
      const payload = body as Record<string, unknown>;
      const rules = payload.rules as { type?: string } | undefined;
      if (
        (rules?.type === 'formula' ||
          path.endsWith('/formula/preview') ||
          'presentation' in payload) &&
        !('catalogRevision' in payload)
      ) {
        const catalog = (await this.request(
          `/api/tables/properties/formula/catalog?tableId=${tableId}`,
        )) as { revision: string };
        body = { ...payload, catalogRevision: catalog.revision };
      }
    }
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
  async login(persona: string) {
    await this.request('/api/auth/password-login', 'POST', {
      identifier: persona.includes('@') ? persona : personaEmail(`tenancy.user.${persona}`),
      password: qa.QA_SEED_PASSWORD ?? QA_PASSWORD,
    });
  }
}
const owner = new Client();
const masked = new Client();
const viewer = new Client();
async function create(label: string, expression: string) {
  const { definition } = (await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `Presentation QA ${runId} ${label}`,
      rules: { type: 'formula', expression },
      hasDefault: false,
    },
    201,
  )) as { definition: CustomPropertyDefinition };
  created.push(definition);
  return definition;
}
async function patch(
  client: Client,
  definition: CustomPropertyDefinition,
  body: Record<string, unknown>,
  expected = 200,
) {
  const result = (await client.request(
    `/api/tables/properties/${definition.id}`,
    'PATCH',
    { tableId, expectedVersion: definition.version, ...body },
    expected,
  )) as { definition?: CustomPropertyDefinition };
  if (result.definition) Object.assign(definition, result.definition);
  return result.definition;
}
async function list(client = owner) {
  return (
    (await client.request(`/api/tables/properties?tableId=${tableId}&includeArchived=1`)) as {
      definitions: CustomPropertyDefinition[];
    }
  ).definitions;
}
async function query(client = owner) {
  return (await client.request('/api/tables/properties/values/query', 'POST', {
    tableId,
    recordIds: [recordId],
  })) as CustomPropertyBundle;
}
function passed(name: string) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

try {
  await owner.login('owner');
  await masked.login('presentation.persona.finance-masked-manager@qa.minion.test');
  await viewer.login('viewer');
  const main = await create('Margin', 'ROUND("Sale price" - "Estimated unit cost", 2)');
  const ratio = await create('Ratio', `"${main.label}" / NULLIF("Sale price", "Sale price" * 0)`);
  const presentation = {
    version: 1,
    number,
    tone: 'sign',
    secondary: { propertyId: ratio.id, format: ratioFormat },
  };
  const originalRules = structuredClone(main.rules);
  const priorVersion = main.version;
  await patch(owner, main, { presentation });
  assert.deepEqual(main.presentation, presentation);
  assert.deepEqual(main.rules, originalRules);
  await owner.request(
    `/api/tables/properties/${main.id}`,
    'PATCH',
    { tableId, expectedVersion: priorVersion, presentation: null },
    409,
  );
  const bundle = await query();
  assert.equal(bundle.values[recordId][main.id].effectiveValue, 60);
  assert.equal(bundle.values[recordId][ratio.id].effectiveValue, 0.6);
  assert.deepEqual(bundle.definitions.find((d) => d.id === main.id)?.presentation, presentation);
  passed('persisted presentation, unchanged AST/numeric values and stale-CAS rejection');

  await patch(owner, main, { description: 'Unrelated metadata preserves presentation' });
  assert.deepEqual(main.presentation, presentation);
  await patch(viewer, main, { presentation: null }, 403);
  await patch(
    owner,
    main,
    { presentation: { ...presentation, number: { ...number, decimals: 7 } } },
    400,
  );
  await patch(owner, main, { presentation: { ...presentation, css: 'color:red' } }, 400);
  await patch(
    owner,
    main,
    { presentation: { ...presentation, secondary: { propertyId: main.id, format: ratioFormat } } },
    422,
  );
  await patch(owner, ratio, { presentation: { ...presentation, secondary: null } }, 422);
  const text = await create('Text', "'text'");
  await patch(owner, text, { presentation: { ...presentation, secondary: null } }, 422);
  passed('format allowlist, numeric applicability and manager-only writes');

  const publicFormula = await create('Public', '"Sale price" * 2');
  const hiddenPresentation = {
    ...presentation,
    secondary: { propertyId: main.id, format: number },
  };
  await patch(owner, publicFormula, { presentation: hiddenPresentation });
  const maskedDefinitions = await list(masked);
  const projected = maskedDefinitions.find((d) => d.id === publicFormula.id)!;
  assert(projected);
  assert.equal(projected.presentationRestricted, true);
  assert.equal(projected.presentation?.secondary, null);
  assert(!JSON.stringify(maskedDefinitions).includes(main.id));
  const maskedBundle = await query(masked);
  assert.equal(maskedBundle.values[recordId][publicFormula.id].effectiveValue, 200);
  assert(!JSON.stringify(maskedBundle).includes(main.id));
  const maskedCatalog = await masked.request(
    `/api/tables/properties/formula/catalog?tableId=${tableId}`,
  );
  assert(!JSON.stringify(maskedCatalog).includes(main.id));
  passed('secondary ID and value redaction across lists/catalog/bundles without hiding primary');

  await patch(masked, projected, { description: 'Masked manager metadata edit' });
  assert(projected.presentationRestricted);
  await patch(masked, projected, { rules: { type: 'formula', expression: '"Sale price" * 3' } });
  assert(projected.presentationRestricted);
  await patch(masked, projected, { presentation: null }, 422);
  await patch(masked, projected, { presentation: { ...presentation, secondary: null } }, 422);
  const canonical = (await list()).find((d) => d.id === publicFormula.id)!;
  assert.deepEqual(canonical.presentation, hiddenPresentation);
  Object.assign(publicFormula, canonical);
  passed('restricted manager cannot erase or replace hidden presentation on unrelated saves');

  for (const action of ['archive', 'restore'] as const) {
    const result = (await masked.request(
      `/api/tables/properties/${publicFormula.id}`,
      action === 'archive' ? 'DELETE' : 'PATCH',
      {
        tableId,
        expectedVersion: projected.version,
        ...(action === 'restore' ? { action } : {}),
      },
    )) as { definition: CustomPropertyDefinition };
    Object.assign(projected, result.definition);
    assert(result.definition.presentationRestricted);
    assert(!JSON.stringify(result).includes(main.id));
  }
  Object.assign(
    publicFormula,
    (await list()).find((d) => d.id === publicFormula.id)!,
  );
  await patch(owner, publicFormula, { presentation: null });
  assert.equal(publicFormula.presentation, null);
  passed('lifecycle responses are redacted and privileged explicit clear succeeds');

  const archived = (await owner.request(`/api/tables/properties/${ratio.id}`, 'DELETE', {
    tableId,
    expectedVersion: ratio.version,
  })) as { definition: CustomPropertyDefinition };
  Object.assign(ratio, archived.definition);
  const afterArchive = await query();
  assert.equal(afterArchive.values[recordId][main.id].effectiveValue, 60);
  assert.equal(
    afterArchive.definitions.find((d) => d.id === main.id)?.presentation?.secondary?.propertyId,
    ratio.id,
  );
  await patch(owner, main, { description: 'Archived caption does not block unrelated changes' });
  await patch(owner, main, { presentation: null });
  assert.equal(main.presentation, null);
  passed('display references do not block target archive or primary computation');

  console.log(`PASS ${checks.length} calculated-column presentation HTTP groups`);
} finally {
  const definitions = await list().catch(() => []);
  for (const definition of [...created].reverse()) {
    const current = definitions.find((d) => d.id === definition.id);
    if (!current || current.archivedAt) continue;
    try {
      await owner.request(`/api/tables/properties/${definition.id}`, 'DELETE', {
        tableId,
        expectedVersion: current.version,
      });
    } catch (error) {
      console.error(`Cleanup failed for QA property ${definition.id}`, error);
    }
  }
}
