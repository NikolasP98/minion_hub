import { insertReliabilityEvents, type ReliabilityEventInput } from './reliability.service';
import { insertCredentialHealthSnapshot, type CredentialHealthInput } from './credential-health.service';
import { insertSkillStats, type SkillStatInput } from './skill-stats.service';
import { gatewayHeartbeats } from '$server/db/schema';
import { nowMs } from '$server/db/utils';
import type { TenantContext } from './base';

export interface HeartbeatInput {
  serverId: string;
  uptimeMs: number;
  activeSessions: number;
  activeAgents: number;
  memoryRssMb?: number;
  credentialSummaryJson?: string;
  channelStatusJson?: string;
  capturedAt: number;
}

export interface MetricsBatchInput {
  reliabilityEvents?: ReliabilityEventInput[];
  credentialHealth?: {
    serverId: string;
    snapshotJson: string;
    capturedAt: number;
  };
  skillStats?: SkillStatInput[];
  heartbeat?: HeartbeatInput;
}

export async function processMetricsBatch(
  ctx: TenantContext,
  batch: MetricsBatchInput,
  serverId: string,
) {
  // Ensure all serverId fields match the authenticated server
  if (batch.reliabilityEvents?.length) {
    const events = batch.reliabilityEvents.map((e) => ({
      ...e,
      serverId,
    }));
    await insertReliabilityEvents(ctx, events);
  }

  if (batch.credentialHealth) {
    await insertCredentialHealthSnapshot(ctx, {
      serverId,
      snapshotJson: batch.credentialHealth.snapshotJson,
      capturedAt: batch.credentialHealth.capturedAt,
    });
  }

  if (batch.skillStats?.length) {
    const stats = batch.skillStats.map((s) => ({
      ...s,
      serverId,
    }));
    await insertSkillStats(ctx, stats);
  }

  if (batch.heartbeat) {
    await ctx.db.insert(gatewayHeartbeats).values({
      tenantId: ctx.tenantId,
      serverId,
      uptimeMs: batch.heartbeat.uptimeMs,
      activeSessions: batch.heartbeat.activeSessions,
      activeAgents: batch.heartbeat.activeAgents,
      memoryRssMb: batch.heartbeat.memoryRssMb ?? null,
      credentialSummaryJson: batch.heartbeat.credentialSummaryJson ?? null,
      channelStatusJson: batch.heartbeat.channelStatusJson ?? null,
      capturedAt: batch.heartbeat.capturedAt,
    });
  }
}
