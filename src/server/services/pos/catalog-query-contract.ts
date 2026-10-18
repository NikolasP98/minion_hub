/** Declared with its handler; discovery never infers callable tools from route names. */
export const CATALOG_QUERY_CONTRACT = {
  name: 'catalog_query',
  version: 1,
  lifecycle: 'active',
  description:
    'Read current active catalog prices, highest first. Answer most expensive product questions directly with prices and source links. Product is the default; choose service, bundle, or all only when requested. Reports missing prices and all maximum-price ties even when results are limited. Never compares revenue or cost.',
  method: 'GET',
  path: '/api/gateway/query/catalog',
  permission: { module: 'pos', action: 'view' },
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['product', 'service', 'bundle', 'all'], default: 'product' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
    },
    additionalProperties: false,
  },
  source: { label: 'Product catalog', path: '/pos/catalog' },
} as const;

export type CatalogKind = (typeof CATALOG_QUERY_CONTRACT.inputSchema.properties.kind.enum)[number];
