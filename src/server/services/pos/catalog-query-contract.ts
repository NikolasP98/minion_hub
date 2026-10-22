/** Declared with its handler; discovery never infers callable tools from route names. */
export const CATALOG_QUERY_CONTRACT = {
  name: 'catalog_query',
  version: 2,
  lifecycle: 'active',
  description:
    'Read current active catalog sale prices with source links. For most expensive questions use mode=maximum (default): returns only the highest-priced items, including all tied winners up to 20, in one call. Name every returned winner; if truncated, disclose the full tiedAtMaximum count and that only 20 are shown. Use mode=ranked for a descending price list with a strict limit. Product is the default; choose service, bundle, or all only when requested. Answer directly and link the source; never navigate automatically. Reports missing prices. Never compares revenue or cost.',
  method: 'GET',
  path: '/api/gateway/query/catalog',
  permission: { module: 'pos', action: 'view' },
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['product', 'service', 'bundle', 'all'], default: 'product' },
      mode: { type: 'string', enum: ['maximum', 'ranked'], default: 'maximum' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        default: 5,
        description:
          'Row limit for mode=ranked only. Maximum mode always includes up to 20 tied winners and reports its appliedLimit.',
      },
    },
    additionalProperties: false,
  },
  source: { label: 'Product catalog', path: '/pos/catalog' },
} as const;

export type CatalogKind = (typeof CATALOG_QUERY_CONTRACT.inputSchema.properties.kind.enum)[number];
export type CatalogQueryMode =
  (typeof CATALOG_QUERY_CONTRACT.inputSchema.properties.mode.enum)[number];
