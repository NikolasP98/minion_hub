import { eq, and, desc } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { agentArtifacts, type AgentArtifactRow } from '$server/db/pg-artifacts-schema';
import type { ArtifactDescriptor } from '$lib/agents/artifacts';

export function artifactRowToDescriptor(row: AgentArtifactRow): ArtifactDescriptor {
  return {
    id: row.id, agentId: row.agentId, slot: 'detail', title: row.title,
    description: row.description, icon: row.icon, kind: 'static',
    entrypoint: 'index.html', deletable: true,
  };
}

const scope = (ctx: CoreCtx) => ({ db: getCoreDb(), tenantId: ctx.tenantId });

export function listArtifactRows(ctx: CoreCtx, agentId: string): Promise<AgentArtifactRow[]> {
  return withOrgCore(scope(ctx), (tx) =>
    tx.select().from(agentArtifacts)
      .where(and(eq(agentArtifacts.orgId, ctx.tenantId), eq(agentArtifacts.agentId, agentId)))
      .orderBy(desc(agentArtifacts.createdAt)),
  );
}

export function getArtifactRow(ctx: CoreCtx, id: string): Promise<AgentArtifactRow | null> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx
      .select()
      .from(agentArtifacts)
      .where(and(eq(agentArtifacts.id, id), eq(agentArtifacts.orgId, ctx.tenantId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

export function createArtifactRow(
  ctx: CoreCtx,
  input: { agentId: string; title: string; description: string; icon: string; html: string },
): Promise<AgentArtifactRow> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.insert(agentArtifacts).values({
      orgId: ctx.tenantId, agentId: input.agentId, title: input.title,
      description: input.description, icon: input.icon, html: input.html,
      createdBy: ctx.profileId ?? null,
    }).returning();
    return rows[0];
  });
}

export function deleteArtifactRow(ctx: CoreCtx, id: string): Promise<void> {
  return withOrgCore(scope(ctx), async (tx) => {
    await tx.delete(agentArtifacts).where(and(eq(agentArtifacts.id, id), eq(agentArtifacts.orgId, ctx.tenantId)));
  });
}
