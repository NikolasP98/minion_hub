#!/usr/bin/env bun
/** Real HTTP qualification against the seeded loopback app. Never production. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnvFile } from './snapshot-env';
import { matrixUuid, personaEmail, QA_PASSWORD } from './seed/ids';
import type {
  CustomPropertyBundle,
  CustomPropertyDefinition,
  CustomPropertyRules,
  CustomPropertyValue,
  CustomPropertyValueCell,
} from '../../src/lib/tables/custom-properties';

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5198';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback QA only');
const qa = parseEnvFile(readFileSync('.env.qa.local', 'utf8'));
const password = qa.QA_SEED_PASSWORD ?? QA_PASSWORD;
const tableId = 'pos.catalog';
const recordId = matrixUuid('catalog.product.tracked');
const otherRecordId = matrixUuid('catalog.service.plain');
const runId = crypto.randomUUID().slice(0, 8);
const checks: string[] = [];

class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, expected = 200): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        origin: base,
        'content-type': 'application/json',
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
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
    assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 250)}`);
    return text ? JSON.parse(text) : null;
  }
  async login(persona: string): Promise<void> {
    await this.request('/api/auth/password-login', 'POST', {
      identifier: personaEmail(`tenancy.user.${persona}`),
      password,
    });
  }
}

const owner = new Client();
const viewer = new Client();
const editor = new Client();
const created = new Map<string, CustomPropertyDefinition>();
const optionA = {
  id: crypto.randomUUID(),
  label: 'Option A',
  color: '#3b82f6' as const,
  archivedAt: null,
};
const optionB = {
  id: crypto.randomUUID(),
  label: 'Option B',
  color: '#10b981' as const,
  archivedAt: null,
};

async function create(rules: CustomPropertyRules, defaultValue: CustomPropertyValue) {
  const response = (await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `HTTP QA ${runId} ${rules.type}`,
      rules,
      hasDefault: true,
      defaultValue,
    },
    201,
  )) as { definition: CustomPropertyDefinition };
  created.set(response.definition.id, response.definition);
  return response.definition;
}
async function query(ids = [recordId, otherRecordId]): Promise<CustomPropertyBundle> {
  return (await owner.request('/api/tables/properties/values/query', 'POST', {
    tableId,
    recordIds: ids,
  })) as CustomPropertyBundle;
}
async function put(
  def: CustomPropertyDefinition,
  value: CustomPropertyValue,
  version: number,
  expected = 200,
  id = recordId,
) {
  return (await owner.request(
    '/api/tables/properties/values',
    'PUT',
    {
      tableId,
      propertyId: def.id,
      recordId: id,
      value,
      expectedVersion: version,
    },
    expected,
  )) as { cell: CustomPropertyValueCell };
}
async function patch(def: CustomPropertyDefinition, change: Record<string, unknown>) {
  const response = (await owner.request(`/api/tables/properties/${def.id}`, 'PATCH', {
    tableId,
    expectedVersion: def.version,
    ...change,
  })) as { definition: CustomPropertyDefinition };
  created.set(def.id, response.definition);
  return response.definition;
}

try {
  await owner.login('owner');
  await viewer.login('viewer');
  await editor.login('staff');
  const text = await create({ type: 'text', maxLength: 12 }, 'Default');
  const number = await create({ type: 'number', min: 0, max: 100, precision: 2 }, 0);
  const date = await create({ type: 'date', min: '1900-01-01', max: '2100-12-31' }, '2000-01-01');
  const boolean = await create({ type: 'boolean' }, false);
  let select = await create({ type: 'select', options: [optionA, optionB] }, optionA.id);
  const multi = await create(
    { type: 'multi_select', options: [optionA, optionB], maxSelections: 2 },
    [],
  );
  checks.push('create all six types');

  let bundle = await query();
  assert.equal(bundle.values[recordId][number.id].effectiveValue, 0);
  assert.equal(bundle.values[recordId][boolean.id].effectiveValue, false);
  assert.equal(bundle.values[recordId][text.id].present, false);
  assert.equal(bundle.values[recordId][text.id].version, 0);
  checks.push('defaults preserve zero/false and absent version');

  for (const [def, value] of [
    [text, 'Custom'],
    [number, 12.34],
    [date, '2004-02-29'],
    [boolean, true],
    [select, optionA.id],
    [multi, [optionA.id, optionB.id]],
  ] as Array<[CustomPropertyDefinition, CustomPropertyValue]>) {
    const saved = await put(def, value, 0);
    assert.deepEqual(saved.cell.effectiveValue, value);
    assert.equal(saved.cell.version, 1);
  }
  bundle = await query();
  assert.equal(bundle.values[recordId][text.id].effectiveValue, 'Custom');
  assert.equal(bundle.values[otherRecordId][text.id].effectiveValue, 'Default');
  checks.push('all value types persist independently per record');

  await put(text, 'too-long-for-rule', 1, 422);
  await put(number, 101, 1, 422);
  await put(number, 1.234, 1, 422);
  await put(date, '2025-02-29', 1, 422);
  await put(boolean, 'true', 1, 422);
  await put(select, crypto.randomUUID(), 1, 422);
  await put(text, 'Stale', 0, 409);
  checks.push('invalid values and stale writes rejected');

  await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: `Malformed ${runId}`,
      hasDefault: false,
      rules: { type: 'select' },
    },
    400,
  );
  await owner.request(
    `/api/tables/properties/${number.id}`,
    'PATCH',
    {
      tableId,
      expectedVersion: number.version,
      rules: { type: 'number', min: 0, max: 10, precision: 2 },
    },
    422,
  );
  checks.push('malformed definition and rules invalidating existing values rejected');

  await put(text, null, 1);
  const renamed = await patch(text, { label: `HTTP QA ${runId} renamed`, defaultValue: 'Changed' });
  bundle = await query();
  assert.equal(bundle.values[recordId][text.id].present, true);
  assert.equal(bundle.values[recordId][text.id].effectiveValue, null);
  assert.equal(bundle.values[otherRecordId][text.id].effectiveValue, 'Changed');
  checks.push('rename preserves identity; explicit clear suppresses changed default');

  select = await patch(select, {
    hasDefault: false,
    rules: {
      type: 'select',
      options: [{ ...optionA, label: 'Renamed A', archivedAt: new Date().toISOString() }, optionB],
    },
  });
  await put(select, optionA.id, 1);
  await put(select, optionA.id, 0, 422, otherRecordId);
  checks.push('archived option can be retained but not newly assigned');

  const archived = (await owner.request(`/api/tables/properties/${renamed.id}`, 'DELETE', {
    tableId,
    expectedVersion: renamed.version,
  })) as { definition: CustomPropertyDefinition };
  created.set(renamed.id, archived.definition);
  bundle = await query();
  assert(!bundle.definitions.some((d) => d.id === renamed.id));
  await put(renamed, 'Hidden', 2, 404);
  const restored = await patch(archived.definition, { action: 'restore' });
  assert.equal(restored.id, renamed.id);
  bundle = await query();
  assert.equal(bundle.values[recordId][renamed.id].effectiveValue, null);
  assert.equal(bundle.values[recordId][renamed.id].version, 2);
  checks.push('archive/restore retains values and stable identity');

  await viewer.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: 'Forbidden',
      rules: { type: 'boolean' },
      hasDefault: false,
    },
    403,
  );
  await viewer.request(
    '/api/tables/properties/values',
    'PUT',
    {
      tableId,
      propertyId: boolean.id,
      recordId,
      value: false,
      expectedVersion: 1,
    },
    403,
  );
  await put(boolean, false, 0, 404, crypto.randomUUID());
  checks.push('viewer mutations and nonexistent hosts rejected');

  await editor.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: 'Forbidden editor schema',
      rules: { type: 'boolean' },
      hasDefault: false,
    },
    403,
  );
  await editor.request('/api/tables/properties/values', 'PUT', {
    tableId,
    propertyId: boolean.id,
    recordId,
    value: false,
    expectedVersion: 1,
  });
  bundle = await query();
  assert.equal(bundle.values[recordId][boolean.id].effectiveValue, false);
  await owner.request(
    '/api/tables/properties',
    'POST',
    {
      tableId,
      label: restored.label.toUpperCase(),
      rules: { type: 'boolean' },
      hasDefault: false,
    },
    409,
  );
  await owner.request(
    `/api/tables/properties/${restored.id}`,
    'PATCH',
    {
      tableId,
      expectedVersion: restored.version - 1,
      label: 'Stale schema',
    },
    409,
  );
  checks.push('editor can change values but not schema; duplicate names and stale schema rejected');

  for (const id of ['not-a-uuid', crypto.randomUUID(), restored.id]) {
    await viewer.request(
      `/api/tables/properties/${id}`,
      'DELETE',
      {
        tableId,
        expectedVersion: 1,
      },
      403,
    );
  }
  await owner.request(
    '/api/tables/properties/not-a-uuid',
    'DELETE',
    {
      tableId,
      expectedVersion: 1,
    },
    404,
  );
  checks.push('guessed property IDs authorize uniformly; malformed IDs fail without server errors');

  console.log(JSON.stringify({ base, passed: checks.length, checks }, null, 2));
} finally {
  // Archive only this run's synthetic properties; retain values like the product does.
  for (const def of created.values()) {
    if (!def.archivedAt) {
      await owner
        .request(`/api/tables/properties/${def.id}`, 'DELETE', {
          tableId,
          expectedVersion: def.version,
        })
        .catch(() => console.error(`Cleanup could not archive property ${def.id}`));
    }
  }
}
