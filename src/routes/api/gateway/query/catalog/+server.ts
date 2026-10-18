import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAssistantCapability } from '../../_shared/action-auth';
import { ASSISTANT_TOOL_DECLARATIONS } from '$server/services/assistant-tool-catalog';
import {
  CATALOG_QUERY_CONTRACT,
  type CatalogKind,
} from '$server/services/pos/catalog-query-contract';
import { isModuleEnabled } from '$server/services/modules.service';
import { queryCatalogPrices } from '$server/services/pos/catalog-query';

const headers = { 'cache-control': 'private, no-store' };
export const GET: RequestHandler = async ({ locals, url }) => {
  const { ctx } = await requireAssistantCapability(locals, url, 'pos', 'view');
  const current = ASSISTANT_TOOL_DECLARATIONS.find(
    (tool) => tool.name === CATALOG_QUERY_CONTRACT.name,
  );
  if (
    !current ||
    current.lifecycle !== 'active' ||
    url.searchParams.get('contractRevision') !== current.contractRevision
  ) {
    return json(
      {
        code: 'TOOL_CONTRACT_CHANGED',
        retryable: false,
        error: 'Rediscover the current tool contract before invoking this query.',
      },
      { status: 409, headers },
    );
  }
  const properties = CATALOG_QUERY_CONTRACT.inputSchema.properties;
  const kind = url.searchParams.get('kind') ?? properties.kind.default;
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? properties.limit.default : Number(rawLimit);
  const allowed = new Set(['agentId', 'orgId', 'contractRevision', 'kind', 'limit']);
  const valid =
    [...url.searchParams.keys()].every(
      (key) => allowed.has(key) && url.searchParams.getAll(key).length === 1,
    ) &&
    (properties.kind.enum as readonly string[]).includes(kind) &&
    Number.isInteger(limit) &&
    limit >= properties.limit.minimum &&
    limit <= properties.limit.maximum;
  if (!valid) {
    return json(
      {
        code: 'INVALID_TOOL_ARGUMENTS',
        retryable: false,
        error: 'Expected kind product|service|bundle|all and an integer limit from 1 to 20.',
      },
      { status: 400, headers },
    );
  }
  if (!(await isModuleEnabled(ctx, 'pos'))) {
    return json(
      {
        code: 'TOOL_MODULE_DISABLED',
        retryable: false,
        error: 'The POS module is disabled for this organization.',
      },
      { status: 403, headers },
    );
  }
  return json(await queryCatalogPrices(ctx, kind as CatalogKind, limit), { headers });
};
