import { getDb } from '$server/db/client';
import { backupConfigs, serverProvisionConfigs } from '$server/db/schema';
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
import type { TenantContext } from './base';

let intervalId: ReturnType<typeof setInterval> | null = null;

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

  const db = getDb();
  const configs = await db.select().from(backupConfigs).where(eq(backupConfigs.enabled, 1));

  for (const config of configs) {
    if (!config.schedule || !config.backupHost) continue;
    const cron = parseCron(config.schedule);
    if (!cron) continue;
    if (now.getHours() !== cron.hour || now.getMinutes() !== cron.minute) continue;

    lastRunDate = dateKey;
    const ctx: TenantContext = { db, tenantId: config.tenantId };

    const provConfigs = await db
      .select()
      .from(serverProvisionConfigs)
      .where(eq(serverProvisionConfigs.tenantId, config.tenantId));

    for (const pc of provConfigs) {
      if (!pc.sshHost) continue;
      const provisionConfig = await getProvisionConfig(ctx, pc.serverId);
      if (!provisionConfig) continue;
      const backupConfig = await getBackupConfig(ctx);
      if (!backupConfig?.backupHost) continue;

      const existing = await listSnapshots(ctx, pc.serverId);
      const latestComplete = existing.find((s) => s.status === 'complete');
      const latestPath = latestComplete?.snapshotPath ?? null;

      const timestamp = Date.now();
      const serverName = provisionConfig.agentName?.toLowerCase().replace(/\s+/g, '-') ?? pc.serverId;
      const basePath = backupConfig.backupBasePath ?? '/mnt/agent-data/backups';
      const tsStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
      const snapshotPath = `${basePath}/${serverName}/${tsStr}`;

      const snapshotId = await createSnapshotRecord(ctx, pc.serverId, snapshotPath, timestamp);

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
        const all = await listSnapshots(ctx, pc.serverId);
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
