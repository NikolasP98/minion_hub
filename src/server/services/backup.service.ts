import { eq, and, desc } from 'drizzle-orm';
import { backupConfigs, serverBackups } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import type { TenantContext } from './base';
import type { ProvisionConfig } from './provision.service';
import { sshExec } from './provision.service';
import { spawn } from 'node:child_process';

// ─── Types ──────────────────────────────────────────────────────────

export interface BackupConfig {
  id: string;
  backupHost: string | null;
  backupUser: string | null;
  backupPort: number | null;
  backupBasePath: string | null;
  schedule: string | null;
  retentionCount: number | null;
  enabled: number | null;
}

export interface Snapshot {
  id: string;
  serverId: string;
  snapshotPath: string;
  timestamp: number;
  sizeBytes: number | null;
  status: string;
  createdAt: number;
}

// ─── In-memory lock ─────────────────────────────────────────────────

const activeBackups = new Set<string>();

// ─── Backup Config CRUD ─────────────────────────────────────────────

export async function getBackupConfig(ctx: TenantContext): Promise<BackupConfig | null> {
  const [row] = await ctx.db
    .select()
    .from(backupConfigs)
    .where(eq(backupConfigs.tenantId, ctx.tenantId));
  return row ?? null;
}

export async function upsertBackupConfig(
  ctx: TenantContext,
  input: Partial<Omit<BackupConfig, 'id'>>,
): Promise<string> {
  const now = nowMs();
  const existing = await getBackupConfig(ctx);

  if (existing) {
    const updates: Record<string, unknown> = { updatedAt: now };
    if (input.backupHost !== undefined) updates.backupHost = input.backupHost;
    if (input.backupUser !== undefined) updates.backupUser = input.backupUser;
    if (input.backupPort !== undefined) updates.backupPort = input.backupPort;
    if (input.backupBasePath !== undefined) updates.backupBasePath = input.backupBasePath;
    if (input.schedule !== undefined) updates.schedule = input.schedule;
    if (input.retentionCount !== undefined) updates.retentionCount = input.retentionCount;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    await ctx.db
      .update(backupConfigs)
      .set(updates)
      .where(eq(backupConfigs.id, existing.id));
    return existing.id;
  }

  const id = newId();
  await ctx.db.insert(backupConfigs).values({
    id,
    tenantId: ctx.tenantId,
    backupHost: input.backupHost ?? null,
    backupUser: input.backupUser ?? 'root',
    backupPort: input.backupPort ?? 22,
    backupBasePath: input.backupBasePath ?? '/mnt/agent-data/backups',
    schedule: input.schedule ?? null,
    retentionCount: input.retentionCount ?? 7,
    enabled: input.enabled ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ─── Snapshot CRUD ──────────────────────────────────────────────────

export async function listSnapshots(ctx: TenantContext, serverId: string): Promise<Snapshot[]> {
  return ctx.db
    .select()
    .from(serverBackups)
    .where(
      and(
        eq(serverBackups.serverId, serverId),
        eq(serverBackups.tenantId, ctx.tenantId),
      ),
    )
    .orderBy(desc(serverBackups.timestamp));
}

export async function createSnapshotRecord(
  ctx: TenantContext,
  serverId: string,
  snapshotPath: string,
  timestamp: number,
): Promise<string> {
  const id = newId();
  await ctx.db.insert(serverBackups).values({
    id,
    serverId,
    tenantId: ctx.tenantId,
    snapshotPath,
    timestamp,
    status: 'running',
    createdAt: nowMs(),
  });
  return id;
}

export async function updateSnapshotStatus(
  ctx: TenantContext,
  snapshotId: string,
  status: 'complete' | 'failed',
  sizeBytes?: number,
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (sizeBytes !== undefined) updates.sizeBytes = sizeBytes;
  await ctx.db
    .update(serverBackups)
    .set(updates)
    .where(eq(serverBackups.id, snapshotId));
}

export async function deleteSnapshotRecord(ctx: TenantContext, snapshotId: string): Promise<void> {
  await ctx.db.delete(serverBackups).where(eq(serverBackups.id, snapshotId));
}

// ─── Helper: derive minion user from provision config ───────────────

function getMinionUser(config: ProvisionConfig): string {
  return config.agentName
    ? `minion-${config.agentName.toLowerCase().replace(/\s+/g, '-')}`
    : 'minion';
}

// ─── Test backup host connectivity ──────────────────────────────────

export async function testBackupConnection(
  backupHost: string,
  backupUser: string,
  backupPort: number,
  backupBasePath: string,
): Promise<{ ok: boolean; message: string }> {
  const result = await sshExec(backupHost, backupUser, backupPort, `test -d "${backupBasePath}" && echo OK`);
  if (result.ok && result.stdout.includes('OK')) {
    return { ok: true, message: `Connected. Path ${backupBasePath} exists.` };
  }
  return { ok: false, message: result.stdout || 'Connection failed or path does not exist.' };
}

// ─── Run Backup (SSE stream) ────────────────────────────────────────

export function runBackup(
  provisionConfig: ProvisionConfig,
  backupConfig: BackupConfig,
  latestSnapshotPath: string | null,
  signal: AbortSignal,
): ReadableStream<string> {
  const serverId = provisionConfig.serverId;

  if (activeBackups.has(serverId)) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue('ERROR: Backup already running for this server\n');
        controller.close();
      },
    });
  }

  activeBackups.add(serverId);

  const minionUser = getMinionUser(provisionConfig);
  const backupHost = backupConfig.backupHost!;
  const backupUser = backupConfig.backupUser ?? 'root';
  const backupPort = backupConfig.backupPort ?? 22;
  const basePath = backupConfig.backupBasePath ?? '/mnt/agent-data/backups';
  const serverName = provisionConfig.agentName?.toLowerCase().replace(/\s+/g, '-') ?? serverId;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destPath = `${basePath}/${serverName}/${timestamp}`;

  // Build the rsync command to run ON the gateway server
  let rsyncCmd = `rsync -az --stats`;
  if (latestSnapshotPath) {
    rsyncCmd += ` --link-dest="${latestSnapshotPath}"`;
  }
  if (backupPort !== 22) {
    rsyncCmd += ` -e "ssh -p ${backupPort}"`;
  }
  rsyncCmd += ` /home/${minionUser}/.minion/ ${backupUser}@${backupHost}:${destPath}/`;

  // SSH into gateway and run the rsync command
  const sshArgs = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    '-o', 'BatchMode=yes',
    '-p', String(provisionConfig.sshPort ?? 22),
    `${provisionConfig.sshUser ?? 'root'}@${provisionConfig.sshHost}`,
    rsyncCmd,
  ];

  return new ReadableStream<string>({
    start(controller) {
      const proc = spawn('ssh', sshArgs);

      const onAbort = () => proc.kill('SIGTERM');
      signal.addEventListener('abort', onAbort, { once: true });

      proc.stdout.on('data', (data: Buffer) => {
        try { controller.enqueue(data.toString()); } catch { /* closed */ }
      });
      proc.stderr.on('data', (data: Buffer) => {
        try { controller.enqueue(data.toString()); } catch { /* closed */ }
      });
      proc.on('close', (code) => {
        activeBackups.delete(serverId);
        signal.removeEventListener('abort', onAbort);
        try {
          controller.enqueue(`\n[Process exited with code ${code}]\n`);
          controller.close();
        } catch { /* closed */ }
      });
      proc.on('error', (err) => {
        activeBackups.delete(serverId);
        signal.removeEventListener('abort', onAbort);
        try {
          controller.enqueue(`\nERROR: ${err.message}\n`);
          controller.close();
        } catch { /* closed */ }
      });
    },
    cancel() {
      activeBackups.delete(serverId);
    },
  });
}

// ─── Run Restore (SSE stream) ───────────────────────────────────────

export function runRestore(
  provisionConfig: ProvisionConfig,
  backupConfig: BackupConfig,
  snapshotPath: string,
  signal: AbortSignal,
): ReadableStream<string> {
  const serverId = provisionConfig.serverId;

  if (activeBackups.has(serverId)) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue('ERROR: Backup/restore already running for this server\n');
        controller.close();
      },
    });
  }

  activeBackups.add(serverId);

  const minionUser = getMinionUser(provisionConfig);
  const backupUser = backupConfig.backupUser ?? 'root';
  const backupHost = backupConfig.backupHost!;
  const backupPort = backupConfig.backupPort ?? 22;

  let rsyncCmd = `rsync -az --stats ${backupUser}@${backupHost}:${snapshotPath}/ /home/${minionUser}/.minion/`;
  if (backupPort !== 22) {
    rsyncCmd += ` -e "ssh -p ${backupPort}"`;
  }

  // After rsync, restart the gateway service
  const restartCmd = `sudo -u ${minionUser} bash -c "XDG_RUNTIME_DIR=/run/user/$(id -u ${minionUser}) systemctl --user restart minion-gateway" 2>/dev/null || true`;
  const fullCmd = `${rsyncCmd} && echo '--- Restarting gateway ---' && ${restartCmd}`;

  const sshArgs = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    '-o', 'BatchMode=yes',
    '-p', String(provisionConfig.sshPort ?? 22),
    `${provisionConfig.sshUser ?? 'root'}@${provisionConfig.sshHost}`,
    fullCmd,
  ];

  return new ReadableStream<string>({
    start(controller) {
      const proc = spawn('ssh', sshArgs);

      const onAbort = () => proc.kill('SIGTERM');
      signal.addEventListener('abort', onAbort, { once: true });

      proc.stdout.on('data', (data: Buffer) => {
        try { controller.enqueue(data.toString()); } catch { /* closed */ }
      });
      proc.stderr.on('data', (data: Buffer) => {
        try { controller.enqueue(data.toString()); } catch { /* closed */ }
      });
      proc.on('close', (code) => {
        activeBackups.delete(serverId);
        signal.removeEventListener('abort', onAbort);
        try {
          controller.enqueue(`\n[Process exited with code ${code}]\n`);
          controller.close();
        } catch { /* closed */ }
      });
      proc.on('error', (err) => {
        activeBackups.delete(serverId);
        signal.removeEventListener('abort', onAbort);
        try {
          controller.enqueue(`\nERROR: ${err.message}\n`);
          controller.close();
        } catch { /* closed */ }
      });
    },
    cancel() {
      activeBackups.delete(serverId);
    },
  });
}

// ─── Delete snapshot from backup host ───────────────────────────────

export async function deleteRemoteSnapshot(
  backupConfig: BackupConfig,
  snapshotPath: string,
): Promise<{ ok: boolean; message: string }> {
  const result = await sshExec(
    backupConfig.backupHost!,
    backupConfig.backupUser ?? 'root',
    backupConfig.backupPort ?? 22,
    `rm -rf "${snapshotPath}"`,
  );
  return {
    ok: result.ok,
    message: result.ok ? 'Snapshot deleted.' : 'Failed to delete snapshot.',
  };
}

// ─── Get disk usage for snapshot ────────────────────────────────────

export async function getSnapshotSize(
  backupConfig: BackupConfig,
  snapshotPath: string,
): Promise<number | null> {
  const result = await sshExec(
    backupConfig.backupHost!,
    backupConfig.backupUser ?? 'root',
    backupConfig.backupPort ?? 22,
    `du -sb "${snapshotPath}" | cut -f1`,
  );
  if (result.ok) {
    const bytes = parseInt(result.stdout, 10);
    return isNaN(bytes) ? null : bytes;
  }
  return null;
}
