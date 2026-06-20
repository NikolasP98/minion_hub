import { eq, and, desc, lte, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { agentArtifacts, type AgentArtifactRow } from '$server/db/pg-artifacts-schema';
import { agentArtifactRevisions, type AgentArtifactRevisionRow } from '$server/db/pg-artifact-revisions-schema';
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
  input: { agentId: string; title: string; description: string; icon: string; html: string; prompt?: string | null },
): Promise<AgentArtifactRow> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.insert(agentArtifacts).values({
      orgId: ctx.tenantId, agentId: input.agentId, title: input.title,
      description: input.description, icon: input.icon, html: input.html,
      prompt: input.prompt ?? null,
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

export function updateArtifactHtml(ctx: CoreCtx, id: string, input: { html: string; prompt?: string | null }): Promise<AgentArtifactRow> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.update(agentArtifacts)
      .set({ html: input.html, prompt: input.prompt ?? null, version: sql`${agentArtifacts.version} + 1`, updatedAt: new Date() })
      .where(and(eq(agentArtifacts.id, id), eq(agentArtifacts.orgId, ctx.tenantId)))
      .returning();
    return rows[0];
  });
}

export function snapshotRevision(ctx: CoreCtx, row: AgentArtifactRow): Promise<void> {
  return withOrgCore(scope(ctx), async (tx) => {
    await tx.insert(agentArtifactRevisions).values({
      orgId: ctx.tenantId, artifactId: row.id, version: row.version, prompt: row.prompt, html: row.html, createdBy: ctx.profileId ?? null,
    });
    // prune: keep the latest 10 revisions per artifact. Versions are contiguous
    // (each snapshot is the then-current version), so a threshold delete suffices.
    await tx.delete(agentArtifactRevisions)
      .where(and(
        eq(agentArtifactRevisions.orgId, ctx.tenantId),
        eq(agentArtifactRevisions.artifactId, row.id),
        lte(agentArtifactRevisions.version, row.version - 10),
      ));
  });
}

export function listRevisions(ctx: CoreCtx, artifactId: string): Promise<Array<{ id: string; version: number; prompt: string | null; createdAt: Date }>> {
  return withOrgCore(scope(ctx), (tx) =>
    tx.select({ id: agentArtifactRevisions.id, version: agentArtifactRevisions.version, prompt: agentArtifactRevisions.prompt, createdAt: agentArtifactRevisions.createdAt })
      .from(agentArtifactRevisions)
      .where(and(eq(agentArtifactRevisions.orgId, ctx.tenantId), eq(agentArtifactRevisions.artifactId, artifactId)))
      .orderBy(desc(agentArtifactRevisions.version)));
}

export function getRevision(ctx: CoreCtx, revisionId: string): Promise<AgentArtifactRevisionRow | null> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.select().from(agentArtifactRevisions)
      .where(and(eq(agentArtifactRevisions.id, revisionId), eq(agentArtifactRevisions.orgId, ctx.tenantId))).limit(1);
    return rows[0] ?? null;
  });
}
