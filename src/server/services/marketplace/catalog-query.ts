import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { marketplaceAgents } from '@minion-stack/db/pg';
import { cached, keys, tags } from '@minion-stack/cache';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { getCoreDb } from '$server/db/pg-client';
import type { MarketplaceFilters } from '$lib/marketplace/catalog';
import { scopeData } from '../base';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();
const schema = z
  .object({
    category: optionalText(64),
    search: optionalText(256),
    model: optionalText(128),
    featured: z.boolean().default(false),
    sort: z.enum(['popular', 'newest', 'name']).default('popular'),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
export function normalizeCatalogFilters(input: MarketplaceFilters) {
  const result = schema.safeParse(input);
  if (!result.success) throw error(400, 'Invalid marketplace filters');
  return result.data;
}
export function parseCatalogQuery(params: URLSearchParams) {
  const input: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) throw error(400, 'Duplicate marketplace filter');
    if (key === 'limit' || key === 'offset') {
      if (!/^(0|[1-9]\d*)$/.test(value)) throw error(400, 'Invalid marketplace pagination');
      input[key] = Number(value);
    } else if (key === 'featured') {
      if (value !== 'true' && value !== 'false') throw error(400, 'Invalid marketplace filter');
      input[key] = value === 'true';
    } else input[key] = value;
  }
  const result = schema.safeParse(input);
  if (!result.success) throw error(400, 'Invalid marketplace filters');
  return result.data;
}
const literalPattern = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

export async function listMarketplacePage(
  db: ReturnType<typeof getCoreDb>,
  input: MarketplaceFilters = {},
) {
  const filters = normalizeCatalogFilters(input);
  const read = () =>
    db.transaction(
      async (tx) => {
        const predicates: SQL[] = [];
        if (filters.category) predicates.push(eq(marketplaceAgents.category, filters.category));
        if (filters.featured)
          predicates.push(sql`coalesce(${marketplaceAgents.installCount}, 0) >= 100`);
        if (filters.model)
          predicates.push(sql`${marketplaceAgents.model} ILIKE ${literalPattern(filters.model)}`);
        if (filters.search) {
          const pattern = literalPattern(filters.search);
          predicates.push(
            sql`(${marketplaceAgents.name} ILIKE ${pattern} OR ${marketplaceAgents.role} ILIKE ${pattern} OR ${marketplaceAgents.description} ILIKE ${pattern} OR ${marketplaceAgents.tags} ILIKE ${pattern})`,
          );
        }
        const where = and(...predicates);
        const [{ count }] = await tx
          .select({ count: sql<string>`count(*)::text` })
          .from(marketplaceAgents)
          .where(where);
        const total = BigInt(count);
        if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw error(503, 'Catalog count unavailable');
        const order =
          filters.sort === 'name'
            ? asc(sql`lower(${marketplaceAgents.name})`)
            : filters.sort === 'newest'
              ? desc(marketplaceAgents.createdAt)
              : sql`${marketplaceAgents.installCount} DESC NULLS LAST`;
        const agents = await tx
          .select({
            id: marketplaceAgents.id,
            name: marketplaceAgents.name,
            role: marketplaceAgents.role,
            category: marketplaceAgents.category,
            tags: marketplaceAgents.tags,
            description: marketplaceAgents.description,
            catchphrase: marketplaceAgents.catchphrase,
            version: marketplaceAgents.version,
            model: marketplaceAgents.model,
            archetype: marketplaceAgents.archetype,
            avatarSeed: marketplaceAgents.avatarSeed,
            githubPath: marketplaceAgents.githubPath,
            installCount: marketplaceAgents.installCount,
            syncedAt: marketplaceAgents.syncedAt,
            createdAt: marketplaceAgents.createdAt,
            updatedAt: marketplaceAgents.updatedAt,
          })
          .from(marketplaceAgents)
          .where(where)
          .orderBy(order, asc(marketplaceAgents.id))
          .limit(filters.limit)
          .offset(filters.offset);
        return { agents, total: Number(total), limit: filters.limit, offset: filters.offset };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  // Public queries can otherwise allocate one persistent key per arbitrary search.
  // Only 3 sort orders × 2 featured states are admitted; all other reads bypass.
  const cacheable =
    !filters.category &&
    !filters.search &&
    !filters.model &&
    filters.offset === 0 &&
    filters.limit === 50;
  return cacheable
    ? cached(
        keys.hub('marketplace', {
          d: scopeData({ ...filters, featured: String(filters.featured) }),
        }),
        {
          ttl: '10m',
          swr: '30m',
          tags: tags.global('marketplace'),
        },
        read,
      )
    : read();
}

/** Compatibility for internal callers that only need the selected page's records. */
export async function listMarketplaceAgents(
  db: ReturnType<typeof getCoreDb>,
  filters: MarketplaceFilters = {},
) {
  return (await listMarketplacePage(db, filters)).agents;
}
