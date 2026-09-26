#!/usr/bin/env bun
/** Exercise the actual formula routes with seeded loopback records, never production. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnvFile } from './snapshot-env';
import { matrixUuid, personaEmail, QA_PASSWORD } from './seed/ids';
import type {
  CustomPropertyBundle,
  CustomPropertyDefinition,
} from '../../src/lib/tables/custom-properties';
import type { FormulaPreviewResponse } from '../../src/lib/tables/formula/contracts';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5198';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback QA only');
const qa = parseEnvFile(readFileSync('.env.qa.local', 'utf8'));
const tableId = 'pos.catalog';
const recordId = matrixUuid('formula.margin.product-price-100');
const runId = crypto.randomUUID().slice(0, 8);
const created: CustomPropertyDefinition[] = [];
const checks: string[] = [];

class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, expected = 200): Promise<unknown> {
    if (body && typeof body === 'object') {
      const payload = body as Record<string, unknown>;
      const rules = payload.rules as { type?: string } | undefined;
      if (
        (path.endsWith('/formula/preview') || rules?.type === 'formula') &&
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
  async login(persona: string): Promise<void> {
    await this.request('/api/auth/password-login', 'POST', {
      identifier: persona.includes('@') ? persona : personaEmail(`tenancy.user.${persona}`),
      password: qa.QA_SEED_PASSWORD ?? QA_PASSWORD,
    });
  }
}
const owner = new Client();
const viewer = new Client();
async function create(label: string, rules: unknown, hasDefault = false, defaultValue?: unknown) {
  const { definition } = (await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `Formula QA ${runId} ${label}`,
      rules,
      hasDefault,
      defaultValue,
    },
    201,
  )) as { definition: CustomPropertyDefinition };
  created.push(definition);
  return definition;
}
async function query() {
  return (await owner.request('/api/tables/properties/values/query', 'POST', {
    tableId,
    recordIds: [recordId],
  })) as CustomPropertyBundle;
}
async function patch(definition: CustomPropertyDefinition, body: Record<string, unknown>) {
  const result = (await owner.request(`/api/tables/properties/${definition.id}`, 'PATCH', {
    tableId,
    expectedVersion: definition.version,
    ...body,
  })) as { definition: CustomPropertyDefinition };
  Object.assign(definition, result.definition);
  return definition;
}
function passed(name: string) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

try {
  await owner.login('owner');
  await viewer.login('viewer');
  const catalog = (await owner.request(
    `/api/tables/properties/formula/catalog?tableId=${tableId}`,
  )) as {
    fields: Array<{ id: string; label: string; aliases?: string[] }>;
  };
  assert(
    catalog.fields.some((field) => [field.label, ...(field.aliases ?? [])].includes('Sale price')),
  );
  assert(
    catalog.fields.some((field) =>
      [field.label, ...(field.aliases ?? [])].includes('Estimated unit cost'),
    ),
  );
  passed('authorized native source catalog');

  const margin = await create('Margin', {
    type: 'formula',
    expression: 'ROUND("Sale price" - "Estimated unit cost", 2)',
  });
  const bundle = await query();
  assert.equal(bundle.values[recordId]?.[margin.id]?.effectiveValue, 60);
  passed('canonical price100 cost40 margin60');

  const preview = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    expression: 'ROUND("Sale price" - "Estimated unit cost", 2)',
    recordIds: [recordId],
    propertyId: margin.id,
  })) as FormulaPreviewResponse;
  assert.equal(preview.diagnostics.length, 0);
  assert.equal(preview.rows[0]?.result.value, 60);
  assert.equal(preview.rows[0]?.result.formula.quality, 'valid');
  assert.equal(preview.rows[0]?.nativeComparison?.status, 'match');
  assert.equal(preview.rows[0]?.nativeComparison?.delta, 0);
  const division = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    expression: '1 / 0',
    recordIds: [recordId],
  })) as FormulaPreviewResponse;
  assert.equal(division.rows[0]?.result.value, null);
  assert.equal(division.rows[0]?.result.formula.quality, 'error');
  const lazy = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    expression: 'CASE WHEN FALSE THEN 1 / 0 ELSE 1 END',
    recordIds: [recordId],
  })) as FormulaPreviewResponse;
  assert.equal(lazy.rows[0]?.result.value, 1);
  assert.equal(lazy.rows[0]?.result.formula.quality, 'valid');
  const invalid = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    expression: '1 + TRUE',
    recordIds: [recordId],
  })) as FormulaPreviewResponse;
  assert(invalid.diagnostics.length > 0);
  assert.equal(invalid.rows.length, 0);
  passed('preview comparison, runtime errors, lazy branches and static diagnostics');

  const indirectMargin = await create('Indirect margin', {
    type: 'formula',
    expression: `"${margin.label}" * 2`,
  });
  assert.equal((await query()).values[recordId]?.[indirectMargin.id]?.effectiveValue, 120);
  const masked = new Client();
  await masked.login('formula.persona.finance-masked@qa.minion.test');
  const maskedCatalog = (await masked.request(
    `/api/tables/properties/formula/catalog?tableId=${tableId}`,
  )) as { fields: Array<{ id: string; label: string; aliases?: string[] }> };
  assert(
    !maskedCatalog.fields.some((field) =>
      [field.label, ...(field.aliases ?? [])].includes('Estimated unit cost'),
    ),
  );
  const maskedBundle = (await masked.request('/api/tables/properties/values/query', 'POST', {
    tableId,
    recordIds: [recordId],
  })) as CustomPropertyBundle;
  assert(!maskedBundle.definitions.some((definition) => definition.id === margin.id));
  assert(!maskedBundle.values[recordId]?.[margin.id]);
  assert(!maskedBundle.definitions.some((definition) => definition.id === indirectMargin.id));
  assert(!maskedBundle.values[recordId]?.[indirectMargin.id]);
  const maskedDefinitions = (await masked.request(`/api/tables/properties?tableId=${tableId}`)) as {
    definitions: CustomPropertyDefinition[];
  };
  assert(!maskedDefinitions.definitions.some((definition) => definition.id === margin.id));
  await masked.request(
    '/api/tables/properties/formula/preview',
    'POST',
    {
      tableId,
      expression: 'ROUND("Sale price" - "Estimated unit cost", 2)',
      recordIds: [recordId],
      propertyId: margin.id,
    },
    403,
  );
  passed('finance-restricted catalog, formula definition, results and preview');

  const input = await create(
    'Input',
    { type: 'number', min: null, max: null, precision: null },
    true,
    10,
  );
  const derived = await create('Derived', { type: 'formula', expression: `"${input.label}" * 2` });
  assert.equal((await query()).values[recordId]?.[derived.id]?.effectiveValue, 20);
  await owner.request('/api/tables/properties/values', 'PUT', {
    tableId,
    propertyId: input.id,
    recordId,
    value: 6,
    expectedVersion: 0,
  });
  assert.equal((await query()).values[recordId]?.[derived.id]?.effectiveValue, 12);
  await patch(input, { label: `Formula QA ${runId} Renamed input` });
  assert.equal((await query()).values[recordId]?.[derived.id]?.effectiveValue, 12);
  passed('custom defaults, live recomputation and rename-stable dependencies');
  const staleCatalog = (await owner.request(
    `/api/tables/properties/formula/catalog?tableId=${tableId}`,
  )) as { revision: string };
  await patch(input, { description: 'Catalog revision changed deliberately for QA' });
  await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `Formula QA ${runId} Stale`,
      rules: { type: 'formula', expression: '1 + 1' },
      hasDefault: false,
      catalogRevision: staleCatalog.revision,
    },
    409,
  );
  passed('stale source catalog cannot silently rebind expression references');

  await owner.request(
    '/api/tables/properties/values',
    'PUT',
    {
      tableId,
      propertyId: derived.id,
      recordId,
      value: 99,
      expectedVersion: 0,
    },
    422,
  );
  await owner.request(
    `/api/tables/properties/${input.id}`,
    'DELETE',
    {
      tableId,
      expectedVersion: input.version,
    },
    409,
  );
  await owner.request(
    `/api/tables/properties/${derived.id}`,
    'PATCH',
    {
      tableId,
      expectedVersion: derived.version,
      rules: { type: 'formula', expression: `"${derived.label}" + 1` },
    },
    422,
  );
  passed('computed values read-only, active dependencies protected, cycles rejected');

  const cyclePreview = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    propertyId: derived.id,
    expression: `"${derived.label}" + 1`,
    recordIds: [recordId],
  })) as FormulaPreviewResponse;
  assert(cyclePreview.diagnostics.length > 0);
  assert.equal(cyclePreview.rows.length, 0);

  const errored = await create('Runtime error', { type: 'formula', expression: '1 / 0' });
  const skipError = await create('Lazy dependency', {
    type: 'formula',
    expression: `CASE WHEN FALSE THEN "${errored.label}" ELSE 7 END`,
  });
  const lazyBundle = await query();
  assert.equal(lazyBundle.values[recordId]?.[errored.id]?.formula?.quality, 'error');
  assert.equal(lazyBundle.values[recordId]?.[skipError.id]?.effectiveValue, 7);
  assert.equal(lazyBundle.values[recordId]?.[skipError.id]?.formula?.quality, 'valid');
  const dependencyPreview = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    expression: `"${derived.label}" + 1`,
    recordIds: [recordId],
  })) as FormulaPreviewResponse;
  assert.equal(dependencyPreview.rows[0]?.result.value, 13);
  assert.equal(dependencyPreview.rows[0]?.result.formula.quality, 'valid');
  passed('preview cycles diagnosed and referenced formulas preserve lazy errors');

  for (const expression of ["1 + 'text'", 'ROUND(TRUE, 2)', 'SELECT 1', '1; DROP TABLE profiles']) {
    await owner.request(
      '/api/tables/properties',
      'POST',
      {
        tableId,
        label: `Formula QA ${runId} Invalid`,
        rules: { type: 'formula', expression },
        hasDefault: false,
      },
      422,
    );
  }
  passed('incompatible types and unrestricted SQL rejected');

  await viewer.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `Formula QA ${runId} Forbidden`,
      rules: { type: 'formula', expression: '1 + 1' },
      hasDefault: false,
    },
    403,
  );
  passed('viewer cannot manage formula definitions');

  const branchNull = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    expression: "CASE WHEN TRUE THEN 'ready' ELSE NULL END",
    recordIds: [recordId],
  })) as FormulaPreviewResponse;
  assert.equal(branchNull.rows[0]?.result.value, 'ready');
  const round = (await owner.request('/api/tables/properties/formula/preview', 'POST', {
    tableId,
    expression: 'ROUND(-1.005, 2)',
    recordIds: [recordId],
  })) as FormulaPreviewResponse;
  assert.equal(round.rows[0]?.result.value, -1.01);
  passed('polymorphic NULL and documented decimal rounding');

  console.log(`Formula HTTP qualification: ${checks.length} groups passed`);
} finally {
  // Reverse creation order removes dependent formulas before their source inputs.
  for (const definition of [...created].reverse()) {
    try {
      await owner.request(`/api/tables/properties/${definition.id}`, 'DELETE', {
        tableId,
        expectedVersion: definition.version,
      });
    } catch (error) {
      console.error(`QA cleanup failed for ${definition.id}: ${String(error)}`);
      process.exitCode = 1;
    }
  }
}
