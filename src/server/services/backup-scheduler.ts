import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { backupConfigs, serverProvisionConfigs } from '@minion-stack/db/pg';
import { unifiedEvents } from '@minion-stack/db/schema';
import { eq } from 'drizzle-orm';
import {
  getBackupConfig,
  runBackup,
  createSnapshotRecord,
  updateSnapshotStatus,
  getSnapshotSize,
  listSnapshots,
  deleteRemoteSnapshot,
  deleteSnapshotRecord,
} from './backup.service';
import { getProvisionConfig } from './provision.service';
import { getDb } from '$server/db/client';
import { pruneOldEvents } from './events.service';
import { pruneOldChatMessages } from './chat.service';
import type { CoreCtx } from '$server/auth/core-ctx';

let intervalId: ReturnType<typeof setInterval> | null = null;

// Retention windows for the unbounded append-only tables, pruned on the backup
// tick. Mirrors the activity-bins call-site style (a literal window subtracted
// from `Date.now()`). Override via env so retention is tunable without a deploy.
const DAY_MS = 86_400_000;
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const EVENT_RETENTION_MS = num(process.env.HUB_EVENT_RETENTION_DAYS, 30) * DAY_MS;
const CHAT_RETENTION_MS = num(process.env.HUB_CHAT_RETENTION_DAYS, 90) * DAY_MS;

function parseCron(expr: string): { minute: number; hour: number } | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  if (isNaN(minute) || isNaN(hour)) return null;
  return { minute, hour };
}

let lastRunDate = '';

async function tick() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (dateKey === lastRunDate) return;

  const db = getCoreDb();
  // CROSS-TENANT SCAN — system/cron path. This scheduler runs out-of-band of any
  // request, so there is no single org in scope here: it must enumerate every
  // tenant's enabled backup_configs to decide what to run. `withOrgCore` scopes
  // to ONE org and would hide all other tenants' rows, so it is NOT appropriate.
  // This scan legitimately needs the bypass-RLS `getCoreDb()` connection (like
  // telemetry/cron paths). Per-tenant work below is re-scoped per `config.tenantId`.
  const configs = await db.select().from(backupConfigs).where(eq(backupConfigs.enabled, true));

  for (const config of configs) {
    if (!config.schedule || !config.backupHost) continue;
    const cron = parseCron(config.schedule);
    if (!cron) continue;
    if (now.getHours() !== cron.hour || now.getMinutes() !== cron.minute) continue;

    lastRunDate = dateKey;
    const ctx: CoreCtx = { db, tenantId: config.tenantId };

    // Per-tenant: a single org (config.tenantId) is now in scope, so this read
    // runs through `withOrgCore` (non-bypass `app_ledger` role + org GUC) and the
    // server_provision_configs `*_org_guc` RLS policy enforces isolation server-side.
    const provConfigs = await withOrgCore({ db, tenantId: config.tenantId }, (tx) =>
      tx
        .select()
        .from(serverProvisionConfigs)
        .where(eq(serverProvisionConfigs.tenantId, config.tenantId)),
    );

    // Retention: prune the org's two unbounded append-only tables. Best-effort —
    // a prune failure must not abort the backup run.
    //  - chat_messages (pg, org-scoped, no serverId) → one call.
    //  - unified_events (Turso, per-server) → one call per server the tenant has
    //    events for. The event serverId is the legacy Turso id (not the pg
    //    gateway uuid in provConfigs), so we read the distinct ids straight from
    //    the events table rather than reusing pc.gatewayId.
    try {
      await pruneOldChatMessages(ctx, now.getTime() - CHAT_RETENTION_MS);
    } catch (e) {
      console.error('[backup-scheduler] prune chat_messages failed', e);
    }
    try {
      const tursoCtx = { db: getDb(), tenantId: config.tenantId };
      const serverIds = await tursoCtx.db
        .selectDistinct({ serverId: unifiedEvents.serverId })
        .from(unifiedEvents)
        .where(eq(unifiedEvents.tenantId, config.tenantId));
      const eventCutoff = now.getTime() - EVENT_RETENTION_MS;
      for (const { serverId } of serverIds) {
        await pruneOldEvents(tursoCtx, serverId, eventCutoff);
      }
    } catch (e) {
      console.error('[backup-scheduler] prune unified_events failed', e);
    }

    for (const pc of provConfigs) {
      if (!pc.sshHost) continue;
      // pg rows key on gateway_id; the service's serverId param accepts a raw
      // gateway uuid too (resolveGatewayId matches `id::text`), so pass gatewayId.
      const sid = pc.gatewayId;
      const provisionConfig = await getProvisionConfig(ctx, sid);
      if (!provisionConfig) continue;
      const backupConfig = await getBackupConfig(ctx);
      if (!backupConfig?.backupHost) continue;

      const existing = await listSnapshots(ctx, sid);
      const latestComplete = existing.find((s) => s.status === 'complete');
      const latestPath = latestComplete?.snapshotPath ?? null;

      const timestamp = Date.now();
      const serverName = provisionConfig.agentName?.toLowerCase().replace(/\s+/g, '-') ?? sid;
      const basePath = backupConfig.backupBasePath ?? '/mnt/agent-data/backups';
      const tsStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
      const snapshotPath = `${basePath}/${serverName}/${tsStr}`;

      const snapshotId = await createSnapshotRecord(ctx, sid, snapshotPath, timestamp);

      const controller = new AbortController();
      const stream = runBackup(provisionConfig, backupConfig, latestPath, controller.signal);
      const reader = stream.getReader();

      let exitCode: number | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const exitMatch = value.match(/\[Process exited with code (\d+)\]/);
        if (exitMatch) exitCode = parseInt(exitMatch[1], 10);
      }

      const status = exitCode === 0 ? 'complete' : 'failed';
      let sizeBytes: number | undefined;
      if (status === 'complete') {
        sizeBytes = (await getSnapshotSize(backupConfig, snapshotPath)) ?? undefined;
      }
      await updateSnapshotStatus(ctx, snapshotId, status as 'complete' | 'failed', sizeBytes);

      // Retention: delete old snapshots beyond retentionCount
      if (status === 'complete' && backupConfig.retentionCount) {
        const all = await listSnapshots(ctx, sid);
        const completed = all.filter((s) => s.status === 'complete');
        if (completed.length > backupConfig.retentionCount) {
          const toDelete = completed.slice(backupConfig.retentionCount);
          for (const old of toDelete) {
            await deleteRemoteSnapshot(backupConfig, old.snapshotPath);
            await deleteSnapshotRecord(ctx, old.id);
          }
        }
      }

      console.log(`[backup-scheduler] ${serverName}: ${status}`);
    }
  }
}

export function startBackupScheduler() {
  if (intervalId) return;
  intervalId = setInterval(tick, 60_000);
  console.log('[backup-scheduler] Started');
}

export function stopBackupScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
