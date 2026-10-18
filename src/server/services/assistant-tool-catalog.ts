import { createHash } from 'node:crypto';
import type { Capabilities } from './rbac.service';
import { CATALOG_QUERY_CONTRACT } from './pos/catalog-query-contract';

function revision(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

interface AssistantToolContract {
  name: string;
  version: number;
  lifecycle: 'active' | 'deprecated' | 'retired';
  description: string;
  method: 'GET';
  path: string;
  permission: { module: string; action: 'view' };
  inputSchema: { type: 'object'; properties: Record<string, unknown>; additionalProperties: false };
  source: { label: string; path: string };
}

const contracts: AssistantToolContract[] = [CATALOG_QUERY_CONTRACT];
export const ASSISTANT_TOOL_DECLARATIONS = contracts.map((contract) => ({
  ...contract,
  contractRevision: revision(contract),
}));

export function assistantToolCatalog(
  principal: {
    principalId: string;
    orgId: string;
    capabilities: Pick<Capabilities, 'can'>;
  },
  moduleStates: Record<string, boolean>,
) {
  const tools = ASSISTANT_TOOL_DECLARATIONS.filter(
    (tool) =>
      tool.lifecycle === 'active' &&
      moduleStates[tool.permission.module.split('.')[0]] !== false &&
      principal.capabilities.can(tool.permission.module, tool.permission.action),
  );
  return {
    schemaVersion: 1,
    revision: revision(tools),
    generatedAt: new Date().toISOString(),
    principalId: principal.principalId,
    orgId: principal.orgId,
    tools,
  };
}
