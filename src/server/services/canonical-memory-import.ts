import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { JSONValue } from 'postgres';

export interface PersonalMemoryExport {
  schemaVersion: 1;
  agentId: string;
  profileId: string;
  orgId: string;
  exportedAt: number;
  source: { dbPath: string; snapshotSha256: string };
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    data: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
    ttl: number | null;
  }>;
  relationships: Array<{
    fromId: string;
    toId: string;
    relType: string;
    weight: number;
    createdAt: number;
  }>;
}
export function validatePersonalMemoryExport(value: unknown): PersonalMemoryExport {
  if (!value || typeof value !== 'object') throw new Error('Invalid export');
  const doc = value as PersonalMemoryExport;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    doc.schemaVersion !== 1 ||
    !uuid.test(doc.profileId) ||
    !uuid.test(doc.orgId) ||
    typeof doc.agentId !== 'string' ||
    doc.agentId.length > 200 ||
    !doc.source ||
    !/^[0-9a-f]{64}$/.test(doc.source.snapshotSha256) ||
    !Number.isFinite(doc.exportedAt) ||
    !Array.isArray(doc.nodes) ||
    doc.nodes.length > 100000 ||
    !Array.isArray(doc.relationships)
  )
    throw new Error('Invalid export envelope');
  if (
    createHash('sha256')
      .update(JSON.stringify({ nodes: doc.nodes, relationships: doc.relationships }))
      .digest('hex') !== doc.source.snapshotSha256
  )
    throw new Error('Export snapshot digest mismatch');
  const ids = new Set<string>();
  for (const node of doc.nodes) {
    if (
      typeof node.id !== 'string' ||
      !node.id ||
      node.id.length > 200 ||
      ids.has(node.id) ||
      typeof node.label !== 'string' ||
      node.label.length > 4000 ||
      !['entity', 'fact', 'event', 'preference', 'task', 'belief', 'interaction', 'skill'].includes(
        node.type,
      ) ||
      !node.data ||
      typeof node.data !== 'object' ||
      Array.isArray(node.data) ||
      JSON.stringify(node.data).length > 12000 ||
      !Number.isFinite(node.createdAt) ||
      !Number.isFinite(node.updatedAt) ||
      (node.ttl !== null && (!Number.isFinite(node.ttl) || node.ttl < 0))
    )
      throw new Error('Invalid or duplicate memory node');
    if (node.data.orgId !== undefined && node.data.orgId !== doc.orgId)
      throw new Error('Node organization conflicts with selected import scope');
    ids.add(node.id);
  }
  for (const edge of doc.relationships)
    if (
      !ids.has(edge.fromId) ||
      !ids.has(edge.toId) ||
      !['related_to', 'caused_by', 'part_of', 'precedes', 'contradicts'].includes(edge.relType) ||
      !Number.isFinite(edge.weight) ||
      !Number.isFinite(edge.createdAt)
    )
      throw new Error('Invalid or dangling memory relationship');
  return doc;
}
/** Operator-only migration. Default dry-run; source stays unchanged. Uses canonical KG rows. */
export async function importPersonalMemory(
  db: ReturnType<typeof postgres>,
  input: unknown,
  apply = false,
) {
  const doc = validatePersonalMemoryExport(input);
  return db.begin(async (tx) => {
    const assignments =
      await tx`select pa.profile_id from personal_agents pa join gateway g on g.id=pa.gateway_id
    join organization_members m on m.profile_id=pa.profile_id and m.organization_id=g.org_id
    where pa.agent_id=${doc.agentId} and g.org_id=${doc.orgId} and pa.provisioning_status='active' for share of pa,g,m`;
    if (assignments.length !== 1 || assignments[0].profile_id !== doc.profileId)
      throw new Error(
        'Import requires one active persisted agent/profile/gateway/org membership assignment',
      );
    const active = doc.nodes.filter(
      (node) => node.ttl === null || node.createdAt + node.ttl > Date.now(),
    );
    if (!apply)
      return {
        dryRun: true,
        nodes: active.length,
        relationships: doc.relationships.length,
        excludedExpired: doc.nodes.length - active.length,
        sourceSha256: doc.source.snapshotSha256,
      };
    let imported = 0,
      skipped = 0;
    for (const node of active) {
      const relationships = doc.relationships
        .filter((edge) => edge.fromId === node.id)
        .map((edge) => ({
          targetId: edge.toId,
          relType: edge.relType,
          weight: edge.weight,
          createdAt: edge.createdAt,
        }));
      const metadata = {
        kgType: node.type,
        data: node.data,
        relationships,
        importSourceSha256: doc.source.snapshotSha256,
        ...(node.ttl === null ? {} : { expiresAt: node.createdAt + node.ttl }),
      };
      const rows =
        await tx`insert into agent_memories(org_id,agent_id,profile_id,content,source,source_id,category,metadata,created_at,updated_at)
     values(${doc.orgId},${doc.agentId},${doc.profileId},${node.label},'kg',${node.id},${['entity', 'fact', 'preference'].includes(node.type) ? node.type : 'other'},
       ${tx.json(metadata as JSONValue)},${new Date(node.createdAt)},${new Date(node.updatedAt)})
     on conflict(org_id,source,source_id) where source_id is not null do update set
       profile_id=excluded.profile_id,
       metadata=case when agent_memories.updated_at<=excluded.updated_at then excluded.metadata else excluded.metadata||agent_memories.metadata end,
       content=case when agent_memories.updated_at<=excluded.updated_at then excluded.content else agent_memories.content end,
       embedding=case when agent_memories.updated_at<=excluded.updated_at then null else agent_memories.embedding end,
       updated_at=greatest(agent_memories.updated_at,excluded.updated_at)
     where agent_memories.agent_id=excluded.agent_id and (agent_memories.profile_id is null or agent_memories.profile_id=excluded.profile_id) returning id`;
      if (rows.length) imported++;
      else skipped++;
    }
    return {
      dryRun: false,
      imported,
      skipped,
      excludedExpired: doc.nodes.length - active.length,
      sourceSha256: doc.source.snapshotSha256,
    };
  });
}
