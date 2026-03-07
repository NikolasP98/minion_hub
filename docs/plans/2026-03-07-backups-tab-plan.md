# Backups Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Backups settings tab that backs up each gateway server's `.minion` directory to a central backup host via rsync over SSH, with incremental hardlink snapshots, scheduling, and UI-driven restore.

**Architecture:** Hub SSHes into each gateway server (reusing provision SSH credentials), which rsyncs its `.minion/` directory to a remote backup host. Snapshots use `rsync --link-dest` for space-efficient hardlinks. Backup destination is configured globally per tenant. Streaming output uses SSE (same pattern as provisioning).

**Tech Stack:** SvelteKit, Svelte 5 runes, Drizzle ORM + SQLite, node-cron, rsync over SSH, SSE streaming.

---

### Task 1: DB Schema — `backup_configs` table

**Files:**
- Create: `src/server/db/schema/backup-configs.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/relations.ts`

**Step 1: Create the schema file**

```ts
// src/server/db/schema/backup-configs.ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';

export const backupConfigs = sqliteTable(
  'backup_configs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    backupHost: text('backup_host'),
    backupUser: text('backup_user').default('root'),
    backupPort: integer('backup_port').default(22),
    backupBasePath: text('backup_base_path').default('/mnt/agent-data/backups'),
    schedule: text('schedule'),
    retentionCount: integer('retention_count').default(7),
    enabled: integer('enabled').default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_backup_configs_tenant').on(t.tenantId),
  ],
);
```

**Step 2: Add export to `src/server/db/schema/index.ts`**

Add line: `export { backupConfigs } from './backup-configs';`

**Step 3: Add relation to `src/server/db/relations.ts`**

Import `backupConfigs` from schema, then add:

```ts
export const backupConfigsRelations = relations(backupConfigs, ({ one }) => ({
  organization: one(organization, { fields: [backupConfigs.tenantId], references: [organization.id] }),
}));
```

**Step 4: Push schema**

Run: `bun run db:push`

**Step 5: Commit**

```bash
git add src/server/db/schema/backup-configs.ts src/server/db/schema/index.ts src/server/db/relations.ts
git commit -m "feat(backup): add backup_configs schema table"
```

---

### Task 2: DB Schema — `server_backups` table

**Files:**
- Create: `src/server/db/schema/server-backups.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/relations.ts`

**Step 1: Create the schema file**

```ts
// src/server/db/schema/server-backups.ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { organization } from './auth';
import { servers } from './servers';

export const serverBackups = sqliteTable(
  'server_backups',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    snapshotPath: text('snapshot_path').notNull(),
    timestamp: integer('timestamp').notNull(),
    sizeBytes: integer('size_bytes'),
    status: text('status', { enum: ['running', 'complete', 'failed'] }).notNull().default('running'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('idx_server_backups_server').on(t.serverId),
    index('idx_server_backups_tenant').on(t.tenantId),
  ],
);
```

**Step 2: Add export to `src/server/db/schema/index.ts`**

Add line: `export { serverBackups } from './server-backups';`

**Step 3: Add relations to `src/server/db/relations.ts`**

Import `serverBackups` from schema, then add:

```ts
export const serverBackupsRelations = relations(serverBackups, ({ one }) => ({
  server: one(servers, { fields: [serverBackups.serverId], references: [servers.id] }),
  organization: one(organization, { fields: [serverBackups.tenantId], references: [organization.id] }),
}));
```

Also add `serverBackups: many(serverBackups)` to `serversRelations`.

**Step 4: Push schema**

Run: `bun run db:push`

**Step 5: Commit**

```bash
git add src/server/db/schema/server-backups.ts src/server/db/schema/index.ts src/server/db/relations.ts
git commit -m "feat(backup): add server_backups schema table"
```

---

### Task 3: Backup service — core functions

**Files:**
- Create: `src/server/services/backup.service.ts`

**Step 1: Create the service**

The service reuses `sshExec` from provision.service.ts. Extract it to a shared module or import it. Since `sshExec` is not exported, either export it or duplicate the pattern.

The cleanest approach: export `sshExec` from `provision.service.ts` (add `export` keyword to the existing function).

**Step 2: Create `src/server/services/backup.service.ts`**

```ts
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
  rsyncCmd += ` /home/${minionUser}/.minion/ ${backupUser}@${backupHost}:${destPath}/`;
  if (backupPort !== 22) {
    rsyncCmd += ` -e "ssh -p ${backupPort}"`;
  }

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
```

**Step 3: Export `sshExec` from provision.service.ts**

In `src/server/services/provision.service.ts`, change `async function sshExec(` to `export async function sshExec(`.

**Step 4: Commit**

```bash
git add src/server/services/backup.service.ts src/server/services/provision.service.ts
git commit -m "feat(backup): add backup service with rsync streaming"
```

---

### Task 4: API routes — backup config

**Files:**
- Create: `src/routes/api/backup-config/+server.ts`
- Create: `src/routes/api/backup-config/test/+server.ts`

**Step 1: Create `src/routes/api/backup-config/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { getBackupConfig, upsertBackupConfig } from '$server/services/backup.service';

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  const config = await getBackupConfig(ctx);
  return json({ ok: true, config });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  const body = await request.json();
  const id = await upsertBackupConfig(ctx, body);
  return json({ ok: true, id });
};
```

**Step 2: Create `src/routes/api/backup-config/test/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { testBackupConnection } from '$server/services/backup.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const { backupHost, backupUser, backupPort, backupBasePath } = await request.json();
  if (!backupHost) return json({ ok: false, message: 'Backup host is required' }, { status: 400 });
  const result = await testBackupConnection(
    backupHost,
    backupUser ?? 'root',
    backupPort ?? 22,
    backupBasePath ?? '/mnt/agent-data/backups',
  );
  return json(result);
};
```

**Step 3: Commit**

```bash
git add src/routes/api/backup-config/
git commit -m "feat(backup): add backup config API routes"
```

---

### Task 5: API routes — backup run, restore, list, delete

**Files:**
- Create: `src/routes/api/servers/[id]/backups/+server.ts`
- Create: `src/routes/api/servers/[id]/backups/run/+server.ts`
- Create: `src/routes/api/servers/[id]/backups/restore/+server.ts`
- Create: `src/routes/api/servers/[id]/backups/[snapshotId]/+server.ts`

**Step 1: Create `src/routes/api/servers/[id]/backups/+server.ts`** (list snapshots)

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { listSnapshots } from '$server/services/backup.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  const snapshots = await listSnapshots(ctx, params.id!);
  return json({ ok: true, snapshots });
};
```

**Step 2: Create `src/routes/api/servers/[id]/backups/run/+server.ts`** (trigger backup, SSE)

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { getProvisionConfig } from '$server/services/provision.service';
import {
  getBackupConfig,
  runBackup,
  createSnapshotRecord,
  updateSnapshotStatus,
  getSnapshotSize,
  listSnapshots,
} from '$server/services/backup.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);

  const provisionConfig = await getProvisionConfig(ctx, params.id!);
  if (!provisionConfig?.sshHost) {
    return json({ ok: false, error: 'No SSH host configured for this server' }, { status: 400 });
  }

  const backupConfig = await getBackupConfig(ctx);
  if (!backupConfig?.backupHost) {
    return json({ ok: false, error: 'No backup destination configured' }, { status: 400 });
  }

  // Find latest snapshot for --link-dest
  const existing = await listSnapshots(ctx, params.id!);
  const latestComplete = existing.find((s) => s.status === 'complete');
  const latestPath = latestComplete?.snapshotPath ?? null;

  const timestamp = Date.now();
  const serverName = provisionConfig.agentName?.toLowerCase().replace(/\s+/g, '-') ?? params.id!;
  const basePath = backupConfig.backupBasePath ?? '/mnt/agent-data/backups';
  const tsStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-');
  const snapshotPath = `${basePath}/${serverName}/${tsStr}`;

  const snapshotId = await createSnapshotRecord(ctx, params.id!, snapshotPath, timestamp);

  const controller = new AbortController();
  const stream = runBackup(provisionConfig, backupConfig, latestPath, controller.signal);

  const encoder = new TextEncoder();
  const sseStream = new ReadableStream({
    async start(sseController) {
      const reader = stream.getReader();
      let exitCode: number | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const exitMatch = value.match(/\[Process exited with code (\d+)\]/);
          if (exitMatch) exitCode = parseInt(exitMatch[1], 10);

          const lines = value.split('\n');
          for (const line of lines) {
            if (line.length > 0) {
              sseController.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'log', line })}\n\n`),
              );
            }
          }
        }

        const status = exitCode === 0 ? 'complete' : 'failed';
        let sizeBytes: number | undefined;
        if (status === 'complete') {
          sizeBytes = (await getSnapshotSize(backupConfig, snapshotPath)) ?? undefined;
        }
        await updateSnapshotStatus(ctx, snapshotId, status, sizeBytes);

        sseController.enqueue(
          encoder.encode(`event: done\ndata: ${JSON.stringify({ status, snapshotId })}\n\n`),
        );
        sseController.close();
      } catch (err) {
        await updateSnapshotStatus(ctx, snapshotId, 'failed').catch(() => {});
        const msg = err instanceof Error ? err.message : 'Unknown error';
        sseController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', line: msg })}\n\n`),
        );
        sseController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

**Step 3: Create `src/routes/api/servers/[id]/backups/restore/+server.ts`** (trigger restore, SSE)

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { getProvisionConfig } from '$server/services/provision.service';
import { getBackupConfig, runRestore } from '$server/services/backup.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);

  const { snapshotPath } = await request.json();
  if (!snapshotPath) {
    return json({ ok: false, error: 'snapshotPath is required' }, { status: 400 });
  }

  const provisionConfig = await getProvisionConfig(ctx, params.id!);
  if (!provisionConfig?.sshHost) {
    return json({ ok: false, error: 'No SSH host configured for this server' }, { status: 400 });
  }

  const backupConfig = await getBackupConfig(ctx);
  if (!backupConfig?.backupHost) {
    return json({ ok: false, error: 'No backup destination configured' }, { status: 400 });
  }

  const controller = new AbortController();
  const stream = runRestore(provisionConfig, backupConfig, snapshotPath, controller.signal);

  const encoder = new TextEncoder();
  const sseStream = new ReadableStream({
    async start(sseController) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = value.split('\n');
          for (const line of lines) {
            if (line.length > 0) {
              sseController.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'log', line })}\n\n`),
              );
            }
          }
        }
        sseController.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        sseController.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        sseController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', line: msg })}\n\n`),
        );
        sseController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

**Step 4: Create `src/routes/api/servers/[id]/backups/[snapshotId]/+server.ts`** (delete snapshot)

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { serverBackups } from '$server/db/schema';
import {
  getBackupConfig,
  deleteRemoteSnapshot,
  deleteSnapshotRecord,
} from '$server/services/backup.service';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);

  const [snapshot] = await ctx.db
    .select()
    .from(serverBackups)
    .where(eq(serverBackups.id, params.snapshotId!));

  if (!snapshot) {
    return json({ ok: false, error: 'Snapshot not found' }, { status: 404 });
  }

  const backupConfig = await getBackupConfig(ctx);
  if (backupConfig?.backupHost) {
    await deleteRemoteSnapshot(backupConfig, snapshot.snapshotPath);
  }

  await deleteSnapshotRecord(ctx, snapshot.id);
  return json({ ok: true });
};
```

**Step 5: Commit**

```bash
git add src/routes/api/servers/[id]/backups/
git commit -m "feat(backup): add backup run/restore/list/delete API routes"
```

---

### Task 6: Frontend — BackupsTab component

**Files:**
- Create: `src/lib/components/settings/BackupsTab.svelte`
- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/lib/components/settings/SettingsTabBar.svelte`
- Modify: `src/lib/utils/config-schema.ts`

**Step 1: Add 'backups' to tab definitions**

In `src/lib/utils/config-schema.ts`, add to the `TABS` array before the `appearance` entry:
```ts
{ id: 'backups', label: 'Backups', icon: 'DatabaseBackup' },
```

In `src/lib/components/settings/SettingsTabBar.svelte`:
- Import `DatabaseBackup` from `lucide-svelte`
- Add `DatabaseBackup` to the `ICON_MAP`
- Add `'backups'` to `ALL_TABS` before appearance:
  ```ts
  { id: 'backups', label: 'Backups', icon: 'DatabaseBackup' },
  ```

**Step 2: Create `src/lib/components/settings/BackupsTab.svelte`**

This is the main component with two sections:

1. **Backup Destination** card — form for host/user/port/path, test connection, save, schedule/retention
2. **Snapshots** panel — backup now button, snapshot table, restore/delete actions, streaming log output

The component should:
- Fetch backup config on mount from `GET /api/backup-config`
- Fetch snapshots from `GET /api/servers/[id]/backups` when a host is connected
- "Backup Now" triggers `POST /api/servers/[id]/backups/run` and reads SSE stream
- "Restore" triggers `POST /api/servers/[id]/backups/restore` with confirmation dialog
- "Delete" calls `DELETE /api/servers/[id]/backups/[snapshotId]`
- "Test Connection" calls `POST /api/backup-config/test`
- "Save" calls `PUT /api/backup-config`
- Schedule/retention fields are part of the backup config form

Use the same SSE reading pattern as the provision page. Use the existing component styling patterns (bg-card, border-border, rounded-lg, etc.).

The component needs access to the active server ID. Get it from `conn.serverId` (the currently connected host's server ID).

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import {
    DatabaseBackup,
    Play,
    RotateCcw,
    Trash2,
    TestTube,
    Save,
    Loader2,
  } from 'lucide-svelte';

  // ─── Backup config state ───────────────────────────────────────
  let backupHost = $state('');
  let backupUser = $state('root');
  let backupPort = $state(22);
  let backupBasePath = $state('/mnt/agent-data/backups');
  let schedule = $state('');
  let retentionCount = $state(7);
  let enabled = $state(false);
  let configLoaded = $state(false);
  let saving = $state(false);
  let testing = $state(false);
  let testResult = $state<{ ok: boolean; message: string } | null>(null);

  // ─── Snapshots state ──────────────────────────────────────────
  interface Snapshot {
    id: string;
    serverId: string;
    snapshotPath: string;
    timestamp: number;
    sizeBytes: number | null;
    status: string;
    createdAt: number;
  }
  let snapshots = $state<Snapshot[]>([]);
  let loadingSnapshots = $state(false);

  // ─── Streaming state ──────────────────────────────────────────
  let running = $state(false);
  let runningAction = $state<'backup' | 'restore' | null>(null);
  let logLines = $state<string[]>([]);
  let logContainer: HTMLElement | undefined = $state();

  // ─── Confirm restore dialog ───────────────────────────────────
  let confirmRestore = $state<Snapshot | null>(null);

  // ─── Load backup config ───────────────────────────────────────
  async function loadConfig() {
    try {
      const res = await fetch('/api/backup-config');
      const data = await res.json();
      if (data.config) {
        backupHost = data.config.backupHost ?? '';
        backupUser = data.config.backupUser ?? 'root';
        backupPort = data.config.backupPort ?? 22;
        backupBasePath = data.config.backupBasePath ?? '/mnt/agent-data/backups';
        schedule = data.config.schedule ?? '';
        retentionCount = data.config.retentionCount ?? 7;
        enabled = !!data.config.enabled;
      }
      configLoaded = true;
    } catch (e) {
      console.error('Failed to load backup config:', e);
    }
  }

  // ─── Save backup config ───────────────────────────────────────
  async function saveConfig() {
    saving = true;
    try {
      await fetch('/api/backup-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupHost,
          backupUser,
          backupPort,
          backupBasePath,
          schedule: schedule || null,
          retentionCount,
          enabled: enabled ? 1 : 0,
        }),
      });
    } catch (e) {
      console.error('Failed to save backup config:', e);
    } finally {
      saving = false;
    }
  }

  // ─── Test connection ──────────────────────────────────────────
  async function testConnection() {
    testing = true;
    testResult = null;
    try {
      const res = await fetch('/api/backup-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupHost, backupUser, backupPort, backupBasePath }),
      });
      testResult = await res.json();
    } catch {
      testResult = { ok: false, message: 'Request failed' };
    } finally {
      testing = false;
    }
  }

  // ─── Load snapshots ──────────────────────────────────────────
  async function loadSnapshots() {
    if (!conn.serverId) return;
    loadingSnapshots = true;
    try {
      const res = await fetch(`/api/servers/${conn.serverId}/backups`);
      const data = await res.json();
      snapshots = data.snapshots ?? [];
    } catch (e) {
      console.error('Failed to load snapshots:', e);
    } finally {
      loadingSnapshots = false;
    }
  }

  // ─── Run backup (SSE) ────────────────────────────────────────
  async function startBackup() {
    if (!conn.serverId || running) return;
    running = true;
    runningAction = 'backup';
    logLines = [];

    try {
      const res = await fetch(`/api/servers/${conn.serverId}/backups/run`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        logLines = [`Error: ${err.error}`];
        running = false;
        runningAction = null;
        return;
      }
      await readSSE(res);
    } catch (e) {
      logLines = [...logLines, `Error: ${e}`];
    } finally {
      running = false;
      runningAction = null;
      loadSnapshots();
    }
  }

  // ─── Run restore (SSE) ───────────────────────────────────────
  async function startRestore(snapshot: Snapshot) {
    if (!conn.serverId || running) return;
    confirmRestore = null;
    running = true;
    runningAction = 'restore';
    logLines = [];

    try {
      const res = await fetch(`/api/servers/${conn.serverId}/backups/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotPath: snapshot.snapshotPath }),
      });
      if (!res.ok) {
        const err = await res.json();
        logLines = [`Error: ${err.error}`];
        running = false;
        runningAction = null;
        return;
      }
      await readSSE(res);
    } catch (e) {
      logLines = [...logLines, `Error: ${e}`];
    } finally {
      running = false;
      runningAction = null;
    }
  }

  // ─── Delete snapshot ──────────────────────────────────────────
  async function deleteSnapshot(snapshot: Snapshot) {
    if (!conn.serverId) return;
    try {
      await fetch(`/api/servers/${conn.serverId}/backups/${snapshot.id}`, { method: 'DELETE' });
      snapshots = snapshots.filter((s) => s.id !== snapshot.id);
    } catch (e) {
      console.error('Failed to delete snapshot:', e);
    }
  }

  // ─── SSE reader ───────────────────────────────────────────────
  async function readSSE(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.line) {
                logLines = [...logLines, data.line];
                // Auto-scroll
                requestAnimationFrame(() => {
                  if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
                });
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    }
  }

  // ─── Format helpers ───────────────────────────────────────────
  function formatBytes(bytes: number | null): string {
    if (bytes == null) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  // ─── Lifecycle ────────────────────────────────────────────────
  onMount(() => {
    loadConfig();
  });

  $effect(() => {
    if (conn.serverId) loadSnapshots();
  });
</script>

<div class="space-y-4">
  <!-- Backup Destination Config -->
  <div class="bg-card border border-border rounded-lg px-5 py-4">
    <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
      <DatabaseBackup size={13} class="text-muted-foreground/70" />
      Backup Destination
    </h2>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">Host</span>
        <input
          type="text"
          bind:value={backupHost}
          placeholder="backup.example.com"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">User</span>
        <input
          type="text"
          bind:value={backupUser}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">Port</span>
        <input
          type="number"
          bind:value={backupPort}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">Base Path</span>
        <input
          type="text"
          bind:value={backupBasePath}
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
    </div>

    <!-- Schedule & Retention -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      <label class="block">
        <span class="text-xs text-muted-foreground">Schedule (cron)</span>
        <input
          type="text"
          bind:value={schedule}
          placeholder="0 3 * * *"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground">Keep last N</span>
        <input
          type="number"
          bind:value={retentionCount}
          min="1"
          class="mt-1 w-full bg-bg3 border border-border rounded-[5px] text-foreground py-[5px] px-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </label>
      <label class="flex items-center gap-2 self-end pb-1">
        <input type="checkbox" bind:checked={enabled} class="accent-accent" />
        <span class="text-xs text-muted-foreground">Enable scheduled backups</span>
      </label>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-2 mt-4">
      <button
        type="button"
        class="flex items-center gap-1.5 bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-3 disabled:opacity-50"
        onclick={saveConfig}
        disabled={saving}
      >
        <Save size={12} />
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        type="button"
        class="flex items-center gap-1.5 bg-bg3 border border-border rounded-[5px] text-foreground cursor-pointer font-[inherit] text-xs font-medium py-[5px] px-3 hover:border-muted-foreground disabled:opacity-50"
        onclick={testConnection}
        disabled={testing || !backupHost}
      >
        <TestTube size={12} />
        {testing ? 'Testing...' : 'Test Connection'}
      </button>
      {#if testResult}
        <span class="text-xs {testResult.ok ? 'text-green-400' : 'text-destructive'}">
          {testResult.message}
        </span>
      {/if}
    </div>
  </div>

  <!-- Per-Server Backups -->
  {#if !conn.connected}
    <div class="bg-card border border-border rounded-lg px-5 py-8 text-center">
      <p class="text-sm text-muted-foreground">Connect to a host to manage backups</p>
    </div>
  {:else}
    <div class="bg-card border border-border rounded-lg px-5 py-4">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-2">
          Snapshots
        </h2>
        <button
          type="button"
          class="flex items-center gap-1.5 bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-3 disabled:opacity-50"
          onclick={startBackup}
          disabled={running || !backupHost}
        >
          {#if running && runningAction === 'backup'}
            <Loader2 size={12} class="animate-spin" />
            Backing up...
          {:else}
            <Play size={12} />
            Backup Now
          {/if}
        </button>
      </div>

      <!-- Snapshot table -->
      {#if snapshots.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-muted-foreground border-b border-border">
                <th class="text-left py-2 px-2 font-medium">Date</th>
                <th class="text-left py-2 px-2 font-medium">Size</th>
                <th class="text-left py-2 px-2 font-medium">Status</th>
                <th class="text-right py-2 px-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each snapshots as snapshot (snapshot.id)}
                <tr class="border-b border-border/50 hover:bg-bg3/50">
                  <td class="py-2 px-2 text-foreground">{formatDate(snapshot.timestamp)}</td>
                  <td class="py-2 px-2 text-muted-foreground">{formatBytes(snapshot.sizeBytes)}</td>
                  <td class="py-2 px-2">
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
                      {snapshot.status === 'complete' ? 'bg-green-500/10 text-green-400' :
                       snapshot.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                       'bg-yellow-500/10 text-yellow-400'}">
                      {snapshot.status}
                    </span>
                  </td>
                  <td class="py-2 px-2 text-right">
                    <div class="flex items-center justify-end gap-1">
                      {#if snapshot.status === 'complete'}
                        <button
                          type="button"
                          class="p-1 rounded hover:bg-bg3 text-muted-foreground hover:text-foreground transition-colors"
                          title="Restore"
                          onclick={() => (confirmRestore = snapshot)}
                          disabled={running}
                        >
                          <RotateCcw size={13} />
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="p-1 rounded hover:bg-bg3 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete"
                        onclick={() => deleteSnapshot(snapshot)}
                        disabled={running}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if !loadingSnapshots}
        <p class="text-xs text-muted-foreground text-center py-4">No snapshots yet</p>
      {/if}
    </div>

    <!-- Streaming log output -->
    {#if logLines.length > 0}
      <div class="bg-card border border-border rounded-lg px-5 py-4">
        <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
          {runningAction === 'restore' ? 'Restore' : 'Backup'} Log
        </h2>
        <div
          bind:this={logContainer}
          class="bg-bg font-mono text-[11px] text-muted-foreground p-3 rounded border border-border max-h-64 overflow-y-auto"
        >
          {#each logLines as line}
            <div class="whitespace-pre-wrap">{line}</div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Confirm restore dialog -->
    {#if confirmRestore}
      <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-card border border-border rounded-lg p-6 max-w-sm mx-4">
          <h3 class="text-sm font-semibold text-foreground mb-2">Confirm Restore</h3>
          <p class="text-xs text-muted-foreground mb-4">
            This will overwrite the current .minion directory on the gateway with the snapshot
            from {formatDate(confirmRestore.timestamp)} and restart the gateway service.
          </p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="bg-bg3 border border-border rounded-[5px] text-foreground cursor-pointer font-[inherit] text-xs font-medium py-[5px] px-3"
              onclick={() => (confirmRestore = null)}
            >
              Cancel
            </button>
            <button
              type="button"
              class="bg-destructive border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-3"
              onclick={() => startRestore(confirmRestore!)}
            >
              Restore
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}
</div>
```

**Step 3: Wire into settings page**

In `src/routes/settings/+page.svelte`:
- Import `BackupsTab` from `$lib/components/settings/BackupsTab.svelte`
- Add `'backups'` to `HUB_TAB_IDS` set
- Add a tab panel block for backups (same pattern as channels/hosts):

```svelte
<!-- Backups tab panel (hub-managed) -->
<div
    class="tab-panel absolute inset-0 flex flex-col overflow-hidden"
    style:visibility={activeTab === 'backups' ? 'visible' : 'hidden'}
    style:z-index={activeTab === 'backups' ? 1 : 0}
    role="tabpanel"
>
    <div class="flex-1 overflow-y-auto p-6 md:p-10">
        <div class="max-w-2xl mx-auto">
            <BackupsTab />
        </div>
    </div>
</div>
```

**Step 4: Verify build**

Run: `bun run check`

**Step 5: Commit**

```bash
git add src/lib/components/settings/BackupsTab.svelte src/routes/settings/+page.svelte src/lib/components/settings/SettingsTabBar.svelte src/lib/utils/config-schema.ts
git commit -m "feat(backup): add Backups settings tab with backup/restore UI"
```

---

### Task 7: Backup scheduling

**Files:**
- Create: `src/server/services/backup-scheduler.ts`
- Modify: `src/hooks.server.ts` (start scheduler on server boot)

**Step 1: Create the scheduler**

```ts
// src/server/services/backup-scheduler.ts
import { getDb } from '$server/db/client';
import { backupConfigs, serverProvisionConfigs } from '$server/db/schema';
import { eq, and } from 'drizzle-orm';
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
  // Simple cron: supports "M H * * *" format only
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

    // Get all servers with provision configs for this tenant
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
      // eslint-disable-next-line no-constant-condition
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
  intervalId = setInterval(tick, 60_000); // Check every minute
  console.log('[backup-scheduler] Started');
}

export function stopBackupScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
```

**Step 2: Start scheduler in hooks**

In `src/hooks.server.ts`, at the end of the file (or in an appropriate startup block), add:

```ts
import { startBackupScheduler } from '$server/services/backup-scheduler';
startBackupScheduler();
```

**Step 3: Commit**

```bash
git add src/server/services/backup-scheduler.ts src/hooks.server.ts
git commit -m "feat(backup): add cron-based backup scheduler with retention"
```

---

### Task 8: Verify build & type-check

**Step 1: Run type check**

Run: `bun run check`
Expected: No new errors (pre-existing paraglide errors are fine)

**Step 2: Run tests**

Run: `bun run test`
Expected: All existing tests pass

**Step 3: Run dev server and test manually**

Run: `bun run dev`
- Navigate to Settings, verify Backups tab appears
- Fill in backup destination, save, test connection
- If connected to a host, try backup now

**Step 4: Final commit if any fixes needed**

---

## Summary

| Task | What | Files |
|------|-------|-------|
| 1 | `backup_configs` schema | schema, index, relations |
| 2 | `server_backups` schema | schema, index, relations |
| 3 | Backup service | backup.service.ts, provision.service.ts (export sshExec) |
| 4 | Backup config API routes | /api/backup-config, /api/backup-config/test |
| 5 | Backup CRUD API routes | /api/servers/[id]/backups/* |
| 6 | BackupsTab frontend component | BackupsTab.svelte, settings page, tab bar, config-schema |
| 7 | Backup scheduler | backup-scheduler.ts, hooks.server.ts |
| 8 | Verify build & tests | - |
