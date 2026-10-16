import type { JSONValue } from 'postgres';
import { embedText, embeddingsEnabled, toVectorLiteral } from '$server/services/embeddings';
import { randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { getPgClient } from '$server/db/pg-pool';

export interface CanonicalMemoryActor {
  principalId: string;
  orgId: string;
  agentId: string;
}
interface Row {
  source_id: string;
  content: string;
  metadata: Record<string, unknown>;
}
function text(args: Record<string, unknown>, key: string, max = 500): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw error(400, `Invalid ${key}`);
  return value.trim();
}
function data(args: Record<string, unknown>): Record<string, unknown> {
  if (args.data === undefined) return {};
  if (
    !args.data ||
    typeof args.data !== 'object' ||
    Array.isArray(args.data) ||
    JSON.stringify(args.data).length > 12000
  )
    throw error(400, 'Invalid memory data');
  return args.data as Record<string, unknown>;
}
function view(row: Row) {
  return {
    id: row.source_id,
    label: row.content,
    type: row.metadata.kgType ?? 'fact',
    data: row.metadata.data ?? {},
  };
}
/** One canonical store and scope for Hub and WhatsApp. No per-channel memory copy. */
export async function canonicalAgentMemory(
  actor: CanonicalMemoryActor,
  operation: string,
  args: Record<string, unknown>,
  revalidate: () => Promise<void> = async () => {},
) {
  const db = getPgClient();
  const { principalId, orgId, agentId } = actor;
  // Production snapshots install pgvector in public; isolated Supabase/QA
  // databases may install it in extensions. Never depend on role search_path.
  const vectorSchema = await db<{ schema_name: string }[]>`select n.nspname as schema_name
    from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid=e.extnamespace where e.extname='vector'`;
  const schemaName = vectorSchema[0]?.schema_name;
  if (schemaName !== 'public' && schemaName !== 'extensions')
    throw error(503, 'Canonical memory vector storage unavailable');
  const vectorType = schemaName === 'extensions' ? db`extensions.vector` : db`public.vector`;
  const distance =
    schemaName === 'extensions' ? db`OPERATOR(extensions.<=>)` : db`OPERATOR(public.<=>)`;
  // Historical KG mirrors lacked profile_id. Adopt only a unique persisted active
  // agent/profile/gateway/org assignment; a caller-selected agent label is insufficient.
  await db`with assignment as (
   select pa.agent_id,min(pa.profile_id::text)::uuid as profile_id from personal_agents pa
   join gateway g on g.id=pa.gateway_id where pa.agent_id=${agentId} and g.org_id=${orgId}
   and pa.provisioning_status='active' group by pa.agent_id having count(*)=1
 ) update agent_memories m set profile_id=a.profile_id from assignment a
 where m.profile_id is null and m.org_id=${orgId} and m.agent_id=a.agent_id and m.source='kg' and a.profile_id=${principalId}`;

  const embed = async (value: string): Promise<string | null> => {
    await revalidate();
    if (!embeddingsEnabled()) return null;
    try {
      return toVectorLiteral(
        await embedText(value, { signal: AbortSignal.timeout(8000), attemptPolicy: 'single' }),
      );
    } catch {
      return null;
    }
  };
  const limit =
    typeof args.limit === 'number' && Number.isInteger(args.limit)
      ? Math.max(1, Math.min(50, args.limit))
      : 10;
  if (operation === 'remember' || operation === 'remember_extracted') {
    const extracted = operation === 'remember_extracted';
    if (
      extracted &&
      (typeof args.category !== 'string' ||
        !['fact', 'preference', 'decision', 'pattern', 'todo'].includes(args.category) ||
        typeof args.confidence !== 'number' ||
        !Number.isFinite(args.confidence) ||
        args.confidence < 0 ||
        args.confidence > 1)
    )
      throw error(400, 'Invalid extracted memory');
    const label = text(args, extracted ? 'content' : 'label', extracted ? 4000 : 120);
    const memoryData = extracted
      ? {
          content: label,
          category: args.category,
          confidence: args.confidence,
          provenance: 'auto-extract',
        }
      : data(args);
    const type =
      typeof args.type === 'string' &&
      [
        'entity',
        'fact',
        'preference',
        'decision',
        'event',
        'goal',
        'task',
        'belief',
        'interaction',
        'skill',
        'other',
      ].includes(args.type)
        ? args.type
        : extracted
          ? String(args.category)
          : 'fact';
    const id = randomUUID();
    const vector = await embed(label + ' ' + JSON.stringify(memoryData));
    await revalidate();
    const rows = await db<
      Row[]
    >`insert into agent_memories(org_id,agent_id,profile_id,content,source,source_id,category,metadata,embedding)
    values(${orgId},${agentId},${principalId},${label},'kg',${id},${['entity', 'fact', 'preference', 'decision'].includes(type) ? type : 'other'},
    ${db.json({ kgType: type, data: memoryData } as JSONValue)},${vector}::${vectorType}) returning source_id,content,metadata`;
    return view(rows[0]);
  }
  if (operation === 'forget') {
    const id = text(args, 'id', 200);
    const rows =
      await db`delete from agent_memories where org_id=${orgId} and profile_id=${principalId}
    and agent_id=${agentId} and source='kg' and (metadata->>'expiresAt' is null or (metadata->>'expiresAt')::bigint>extract(epoch from now())*1000) and source_id=${id} returning id`;
    return { deleted: rows.length };
  }
  if (operation === 'update_entity') {
    const id = text(args, 'id', 200);
    const label = args.label === undefined ? null : text(args, 'label', 120);
    const patch = data(args);
    if (label === null && args.data === undefined) throw error(400, 'Memory update required');
    const previous = await db<
      (Row & { revision: string })[]
    >`select source_id,content,metadata,xmin::text as revision from agent_memories
    where org_id=${orgId} and profile_id=${principalId} and agent_id=${agentId} and source='kg' and (metadata->>'expiresAt' is null or (metadata->>'expiresAt')::bigint>extract(epoch from now())*1000) and source_id=${id}`;
    if (!previous.length) return null;
    const old = previous[0];
    const merged = { ...((old.metadata.data as Record<string, unknown>) ?? {}), ...patch };
    const vector = await embed((label ?? old.content) + ' ' + JSON.stringify(merged));
    await revalidate();
    const rows = await db<
      Row[]
    >`update agent_memories set content=coalesce(${label},content),embedding=${vector}::${vectorType},updated_at=now(),
    metadata=jsonb_set(metadata,'{data}',${db.json(merged as JSONValue)})
    where org_id=${orgId} and profile_id=${principalId} and agent_id=${agentId} and source='kg' and (metadata->>'expiresAt' is null or (metadata->>'expiresAt')::bigint>extract(epoch from now())*1000) and source_id=${id} and xmin::text=${old.revision}
    returning source_id,content,metadata`;
    if (!rows.length) throw error(409, 'Memory changed; read it again before updating');
    return view(rows[0]);
  }
  if (operation === 'recall_entity') {
    const name = text(args, 'name', 200);
    const rows = await db<
      Row[]
    >`select source_id,content,metadata from agent_memories where org_id=${orgId} and profile_id=${principalId}
    and agent_id=${agentId} and source='kg' and (metadata->>'expiresAt' is null or (metadata->>'expiresAt')::bigint>extract(epoch from now())*1000) and strpos(lower(content),lower(${name}))>0
    order by (lower(content)=lower(${name})) desc,updated_at desc limit 1`;
    return rows[0] ? view(rows[0]) : null;
  }
  if (operation === 'search_facts') {
    const query = text(args, 'query', 2000);
    const vector = await embed(query);
    await revalidate();
    if (vector) {
      const semantic = await db<
        Row[]
      >`select source_id,content,metadata from agent_memories where org_id=${orgId} and profile_id=${principalId}
      and agent_id=${agentId} and source='kg' and (metadata->>'expiresAt' is null or (metadata->>'expiresAt')::bigint>extract(epoch from now())*1000) and embedding is not null and embedding ${distance} ${vector}::${vectorType} <= 0.65
      order by embedding ${distance} ${vector}::${vectorType} limit ${limit}`;
      if (semantic.length) return semantic.map(view);
    }
    const rows = await db<
      Row[]
    >`select source_id,content,metadata from agent_memories where org_id=${orgId} and profile_id=${principalId}
    and agent_id=${agentId} and source='kg' and (metadata->>'expiresAt' is null or (metadata->>'expiresAt')::bigint>extract(epoch from now())*1000) and (strpos(lower(content),lower(${query}))>0
      or to_tsvector('simple',content||' '||coalesce(metadata->'data','{}'::jsonb)::text) @@ websearch_to_tsquery('simple',${query}))
    order by updated_at desc limit ${limit}`;
    return rows.map(view);
  }
  if (operation === 'find_related') {
    const id = text(args, 'entityId', 200);
    // Relationship targets are looked up again under the same actor; a guessed ID cannot cross scope.
    const relType = typeof args.relType === 'string' ? args.relType : null;
    const rows = await db<
      Row[]
    >`select target.source_id,target.content,target.metadata from agent_memories origin
    cross join lateral jsonb_array_elements(coalesce(origin.metadata->'relationships','[]'::jsonb)) edge
    join agent_memories target on target.source_id=edge->>'targetId'
    where origin.org_id=${orgId} and origin.profile_id=${principalId} and origin.agent_id=${agentId} and origin.source='kg' and origin.source_id=${id} and (origin.metadata->>'expiresAt' is null or (origin.metadata->>'expiresAt')::bigint>extract(epoch from now())*1000)
    and target.org_id=${orgId} and target.profile_id=${principalId} and target.agent_id=${agentId} and target.source='kg' and (target.metadata->>'expiresAt' is null or (target.metadata->>'expiresAt')::bigint>extract(epoch from now())*1000)
    and (${relType}::text is null or edge->>'relType'=${relType})
    order by (edge->>'weight')::float desc,target.updated_at desc limit ${limit}`;
    return rows.map(view);
  }
  if (operation === 'link_objects') {
    const fromId = text(args, 'fromId', 200),
      toId = text(args, 'toId', 200);
    const relType = text(args, 'relType', 80);
    if (
      fromId === toId ||
      typeof args.weight !== 'number' ||
      !Number.isFinite(args.weight) ||
      args.weight < 0 ||
      args.weight > 1
    )
      throw error(400, 'Invalid relationship');
    const weight = args.weight;
    await revalidate();
    return db.begin(async (tx) => {
      const targets = await tx`select source_id from agent_memories where org_id=${orgId}
        and profile_id=${principalId} and agent_id=${agentId} and source='kg'
        and source_id in (${fromId},${toId})
        and (metadata->>'expiresAt' is null or (metadata->>'expiresAt')::bigint>extract(epoch from now())*1000)
        order by source_id for update`;
      if (targets.length !== 2) throw error(404, 'Memory relationship target unavailable');
      await revalidate();
      const edge = tx.json([{ targetId: toId, relType, weight }] as JSONValue);
      await tx`update agent_memories set metadata=jsonb_set(metadata,'{relationships}',
        coalesce((select jsonb_agg(e) from jsonb_array_elements(coalesce(metadata->'relationships','[]'::jsonb)) e
          where not (e->>'targetId'=${toId} and e->>'relType'=${relType})),'[]'::jsonb) || ${edge}::jsonb),updated_at=now()
        where org_id=${orgId} and profile_id=${principalId} and agent_id=${agentId} and source='kg' and source_id=${fromId}`;
      return { linked: true };
    });
  }
  throw error(400, 'Unknown memory operation');
}
