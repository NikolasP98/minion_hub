import type { marketplaceAgents } from '@minion-stack/db/pg';
import type { getCoreDb } from '$server/db/pg-client';

export type CatalogDb = ReturnType<typeof getCoreDb>;
export type CatalogTx = Parameters<Parameters<CatalogDb['transaction']>[0]>[0];
export type MarketplaceAgentRecord = typeof marketplaceAgents.$inferSelect;
export interface MarketplaceAgentUpsert {
  id: string;
  name: string;
  role: string;
  category: string;
  tags: string[];
  description: string;
  catchphrase?: string;
  version: string;
  model?: string;
  archetype?: string;
  avatarSeed: string;
  githubPath: string;
}
export class MarketplaceLeaseLost extends Error {
  constructor() {
    super('Marketplace ownership expired');
  }
}
