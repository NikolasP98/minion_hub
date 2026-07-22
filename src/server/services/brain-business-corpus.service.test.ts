import { describe, expect, it } from 'vitest';
import {
  BUSINESS_KNOWLEDGE_DOMAINS,
  BUSINESS_KNOWLEDGE_EXCLUDED_TABLES,
  BUSINESS_FIELD_ALLOWLISTS,
  BUSINESS_PARENT_AGGREGATES,
  businessKnowledgeSourceConfig,
  businessTableIdentityQueryText,
  businessTableQueryText,
  decodeBusinessKnowledgeCursor,
  encodeBusinessKnowledgeCursor,
  getBusinessKnowledgeDomain,
  normalizeBusinessKnowledgeRecord,
  nextBusinessKnowledgeCursor,
  requiredColumnsForBusinessTable,
  sanitizeBusinessKnowledgePayload,
} from './brain-business-corpus.service';

describe('business brain corpus inventory', () => {
  it('covers the required organization business domains with one unique source each', () => {
    const keys = BUSINESS_KNOWLEDGE_DOMAINS.map((domain) => domain.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'stock',
        'crm',
        'socials',
        'finances',
        'schedules',
        'org-chart',
        'projects',
      ]),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(BUSINESS_KNOWLEDGE_DOMAINS.every((domain) => domain.tables.length > 0)).toBe(true);
  });

  it('never selects credential-bearing or noisy derived tables', () => {
    const included = new Set(
      BUSINESS_KNOWLEDGE_DOMAINS.flatMap((domain) => domain.tables.map((table) => table.table)),
    );
    for (const excluded of Object.keys(BUSINESS_KNOWLEDGE_EXCLUDED_TABLES)) {
      expect(included.has(excluded), `${excluded} must remain excluded`).toBe(false);
    }
    expect(BUSINESS_KNOWLEDGE_EXCLUDED_TABLES.meta_connections).toMatch(/token/i);
    expect(BUSINESS_KNOWLEDGE_EXCLUDED_TABLES.notes).toMatch(/personal/i);
  });

  it('declares every column referenced by a production query expression', () => {
    const crmAnalysis = getBusinessKnowledgeDomain('crm').tables.find(
      (table) => table.table === 'crm_conversation_analysis',
    )!;
    expect(requiredColumnsForBusinessTable(crmAnalysis)).toEqual(
      expect.arrayContaining(['org_id', 'channel', 'chat_id', 'last_at', 'analyzed_at']),
    );
    expect(crmAnalysis.idExpression).toBe("r.channel || ':' || r.chat_id");

    const membership = getBusinessKnowledgeDomain('org-chart').tables.find(
      (table) => table.table === 'organization_members',
    )!;
    expect(requiredColumnsForBusinessTable(membership)).toEqual([
      'organization_id',
      'profile_id',
      'role',
    ]);
  });

  it('publishes a safe required module for every source', () => {
    for (const domain of BUSINESS_KNOWLEDGE_DOMAINS) {
      expect(domain.requiredModule).toMatch(/^[a-z][a-z-]*$/);
    }
    expect(getBusinessKnowledgeDomain('finances').requiredModule).toBe('finance');
    expect(getBusinessKnowledgeDomain('socials').requiredModule).toBe('ads');
    expect(getBusinessKnowledgeDomain('crm').requiredFieldLevel).toBe(1);
    expect(getBusinessKnowledgeDomain('finances').requiredFieldLevel).toBe(1);
    expect(getBusinessKnowledgeDomain('schedules').requiredFieldLevel).toBe(1);
    expect(getBusinessKnowledgeDomain('org-chart').requiredFieldLevel).toBe(1);
    expect(
      businessKnowledgeSourceConfig(getBusinessKnowledgeDomain('org-chart')).requiredFieldLevel,
    ).toBe(1);
  });

  it('uses reviewed field allowlists and parent aggregates instead of line telemetry docs', () => {
    const standalone = new Set(
      BUSINESS_KNOWLEDGE_DOMAINS.flatMap((domain) => domain.tables.map((table) => table.table)),
    );
    for (const child of [
      'stk_entry_lines',
      'fin_invoice_items',
      'fin_payments',
      'pos_ticket_lines',
      'pos_payments',
      'meta_ad_posts',
    ]) {
      expect(standalone.has(child), `${child} must be parent-aggregated`).toBe(false);
      expect(BUSINESS_PARENT_AGGREGATES[child]).toBeTruthy();
    }
    for (const table of BUSINESS_KNOWLEDGE_DOMAINS.flatMap((domain) => domain.tables)) {
      expect(
        BUSINESS_FIELD_ALLOWLISTS[table.table] || BUSINESS_PARENT_AGGREGATES[table.table],
        `${table.table} needs an allowlist or reviewed aggregate`,
      ).toBeTruthy();
    }
    expect(
      businessTableQueryText(
        getBusinessKnowledgeDomain('finances').tables.find(
          (table) => table.table === 'fin_invoices',
        )!,
      ),
    ).toMatch(/jsonb_agg[\s\S]*fin_invoice_items[\s\S]*fin_payments/);
    expect(
      businessTableQueryText(
        getBusinessKnowledgeDomain('socials').tables.find(
          (table) => table.table === 'meta_ad_insights',
        )!,
      ),
    ).toMatch(/date_trunc\('month'/);
  });

  it('projects generic payloads through a valid fail-closed jsonb allowlist', () => {
    const query = businessTableQueryText(getBusinessKnowledgeDomain('crm').tables[0]);
    expect(query).toContain('jsonb_each(to_jsonb(r))');
    expect(query).toContain('jsonb_object_agg(field.key, field.value)');
    expect(query).not.toContain('to_jsonb(r) &');
  });

  it('pushes cursors under telemetry aggregation and reconciles by identity only', () => {
    const post = getBusinessKnowledgeDomain('socials').tables.find(
      (table) => table.table === 'meta_post_insights',
    )!;
    const pageQuery = businessTableQueryText(post, "instagram:post'42");
    expect(pageQuery.indexOf("and (r.platform || ':' || r.post_id) >")).toBeLessThan(
      pageQuery.indexOf('group by r.platform, r.post_id'),
    );
    expect(pageQuery).toContain("'instagram:post''42'");

    const invoice = getBusinessKnowledgeDomain('finances').tables[0];
    const identityQuery = businessTableIdentityQueryText(invoice);
    expect(identityQuery).toContain('from fin_invoices r');
    expect(identityQuery).not.toMatch(/fin_invoice_items|jsonb_agg|payload/);
  });
});

describe('business knowledge normalization', () => {
  it('is deterministic across object insertion order', () => {
    const domain = getBusinessKnowledgeDomain('stock');
    const base = {
      externalId: 'stk_items:1',
      recordType: 'stk_items',
      title: 'Serum',
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      sourceUpdatedAt: new Date('2026-01-02T00:00:00Z'),
    };
    const first = normalizeBusinessKnowledgeRecord(domain, {
      ...base,
      payload: { name: 'Serum', code: 'SER-1', nested: { z: 2, a: 1 } },
    });
    const second = normalizeBusinessKnowledgeRecord(domain, {
      ...base,
      payload: { nested: { a: 1, z: 2 }, code: 'SER-1', name: 'Serum' },
    });
    expect(first.normalizedText).toBe(second.normalizedText);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.chunks.map((chunk) => chunk.contentHash)).toEqual(
      second.chunks.map((chunk) => chunk.contentHash),
    );
  });

  it('removes sensitive keys recursively while retaining business fields', () => {
    expect(
      sanitizeBusinessKnowledgePayload({
        name: 'Customer A',
        access_token: 'never-index',
        nested: { password: 'never-index', status: 'active', apiKey: 'never-index' },
        lines: [{ description: 'Procedure', refreshToken: 'never-index' }],
      }),
    ).toEqual({
      lines: [{ description: 'Procedure' }],
      name: 'Customer A',
      nested: { status: 'active' },
    });
  });

  it('uses stable bounded chunks and table-prefixed identities', () => {
    const document = normalizeBusinessKnowledgeRecord(
      getBusinessKnowledgeDomain('projects'),
      {
        externalId: 'proj_tasks:task-1',
        recordType: 'proj_tasks',
        title: 'Launch',
        payload: { description: 'x'.repeat(80), status: 'active' },
        occurredAt: null,
        sourceUpdatedAt: null,
      },
      48,
    );
    expect(document.externalId).toBe('proj_tasks:task-1');
    expect(document.chunks.length).toBeGreaterThan(1);
    expect(document.chunks.every((chunk) => chunk.chunkText.length <= 48)).toBe(true);
    expect(document.chunks.map((chunk) => chunk.chunkKey)).toEqual(
      document.chunks.map((_, index) => `record:${String(index).padStart(6, '0')}`),
    );
  });
});

describe('business knowledge cursors', () => {
  it('round-trips a domain-scoped stable cursor', () => {
    const cursor = { domain: 'finances' as const, tableIndex: 2, lastId: 'abc' };
    expect(decodeBusinessKnowledgeCursor(encodeBusinessKnowledgeCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed and unknown-domain cursors', () => {
    expect(decodeBusinessKnowledgeCursor('not-base64-json')).toBeNull();
    const invalid = Buffer.from(JSON.stringify({ domain: 'secrets', externalId: 'x' })).toString(
      'base64url',
    );
    expect(decodeBusinessKnowledgeCursor(invalid)).toBeNull();
    expect(
      decodeBusinessKnowledgeCursor(
        encodeBusinessKnowledgeCursor({ domain: 'crm', tableIndex: -1, lastId: null }),
      ),
    ).toBeNull();
    expect(
      decodeBusinessKnowledgeCursor(
        encodeBusinessKnowledgeCursor({ domain: 'crm', tableIndex: 99, lastId: null }),
      ),
    ).toBeNull();
  });

  it('continues within one table before advancing to the next table', () => {
    const domain = getBusinessKnowledgeDomain('finances');
    expect(nextBusinessKnowledgeCursor(domain, 0, 'invoice-50', true)).toEqual({
      domain: 'finances',
      tableIndex: 0,
      lastId: 'invoice-50',
    });
    expect(nextBusinessKnowledgeCursor(domain, 0, 'invoice-99', false)).toEqual({
      domain: 'finances',
      tableIndex: 1,
      lastId: null,
    });
    expect(
      nextBusinessKnowledgeCursor(domain, domain.tables.length - 1, 'settings', false),
    ).toBeNull();
  });
});
