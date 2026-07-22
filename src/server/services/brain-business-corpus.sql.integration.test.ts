import postgres from 'postgres';
import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_KNOWLEDGE_DOMAINS,
  businessTableIdentityQueryText,
  businessTableQueryText,
} from './brain-business-corpus.service';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

describe.runIf(Boolean(databaseUrl))('business corpus SQL against PostgreSQL', () => {
  it('EXPLAINs every payload and deletion-identity query against the live schema', async () => {
    const client = postgres(databaseUrl!, {
      max: 1,
      prepare: false,
      idle_timeout: 5,
      connect_timeout: 10,
    });
    let explained = 0;
    try {
      for (const domain of BUSINESS_KNOWLEDGE_DOMAINS) {
        for (const definition of domain.tables) {
          await client.unsafe(
            `explain (format json) select * from (${businessTableQueryText(definition)}) records limit 0`,
          );
          await client.unsafe(
            `explain (format json) select * from (${businessTableIdentityQueryText(definition)}) records limit 0`,
          );
          explained += 2;
        }
      }
    } finally {
      await client.end({ timeout: 5 });
    }
    expect(explained).toBe(
      BUSINESS_KNOWLEDGE_DOMAINS.reduce((sum, domain) => sum + domain.tables.length * 2, 0),
    );
  }, 120_000);
});
