# Backups Tab Design

## Overview

Add a "Backups" settings tab for backing up each gateway server's `.minion` directory to a central Hetzner volume via rsync over SSH. Supports scheduled + manual backups, incremental hardlink snapshots, and UI-driven restore.

## Data Flow

```
Hub (SvelteKit) --SSH--> Gateway Server --rsync--> Backup Host (/mnt/agent-data/backups/<server>/<timestamp>/)
```

- Hub already has SSH access to each gateway (from provisioning).
- Each gateway needs SSH access to the backup host (one authorized key per gateway).
- Incremental snapshots use `rsync --link-dest` for space-efficient hardlinks.

## DB Schema

### `backup_configs` (global per-tenant)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| tenantId | TEXT FK -> organization.id | |
| backupHost | TEXT | e.g., `backup.example.com` |
| backupUser | TEXT | default `root` |
| backupPort | INTEGER | default `22` |
| backupBasePath | TEXT | default `/mnt/agent-data/backups` |
| schedule | TEXT | cron expression, nullable |
| retentionCount | INTEGER | default `7` |
| enabled | INTEGER | default `0` |
| createdAt | INTEGER | |
| updatedAt | INTEGER | |

### `server_backups` (per-server snapshot history)

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| serverId | TEXT FK -> servers.id | |
| tenantId | TEXT FK -> organization.id | |
| snapshotPath | TEXT | Full path on backup host |
| timestamp | INTEGER | Snapshot epoch ms |
| sizeBytes | INTEGER | nullable, populated after completion |
| status | TEXT | `running` / `complete` / `failed` |
| createdAt | INTEGER | |

## Backend Service (`backup.service.ts`)

### `runBackup(provisionConfig, backupConfig, signal) -> ReadableStream<string>`

1. SSH into gateway server (using provision SSH credentials)
2. Determine latest snapshot path for `--link-dest`
3. Run: `rsync -az --link-dest=<latest> /home/<minion-user>/.minion/ backupUser@backupHost:<basePath>/<serverName>/<timestamp>/`
4. Stream rsync output via SSE (same pattern as `runSetupPhase`)
5. On completion, record snapshot in `server_backups` table

### `runRestore(provisionConfig, backupConfig, snapshotPath, signal) -> ReadableStream<string>`

1. SSH into gateway server
2. Run: `rsync -az backupUser@backupHost:<snapshotPath>/ /home/<minion-user>/.minion/`
3. Optionally restart gateway service after successful restore
4. Stream output via SSE

### `listSnapshots(provisionConfig, backupConfig) -> Snapshot[]`

SSH into backup host, list server's backup directory, return timestamps + sizes.

### `deleteSnapshot(provisionConfig, backupConfig, snapshotPath)`

SSH into backup host, `rm -rf` the specific snapshot directory.

### Scheduling

`node-cron` or `setInterval` on server startup. Checks `backup_configs` for enabled schedules, runs backups for all servers with provision configs.

## API Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/backup-config` | Get global backup destination config |
| PUT | `/api/backup-config` | Update backup destination config |
| POST | `/api/backup-config/test` | Test SSH connection to backup host |
| POST | `/api/servers/[id]/backups/run` | Trigger backup (SSE stream) |
| POST | `/api/servers/[id]/backups/restore` | Trigger restore (SSE stream, body: `{ snapshot }`) |
| GET | `/api/servers/[id]/backups` | List snapshots |
| DELETE | `/api/servers/[id]/backups/[timestamp]` | Delete snapshot |

All routes require admin access (`requireAdmin`).

## Frontend — Backups Tab

### Backup Destination Card (top)

- Form fields: Host, User, Port, Base Path
- "Test Connection" button (SSHes into backup host, checks path exists)
- Save button
- Schedule: cron expression input + enable/disable toggle
- Retention: "Keep last N snapshots" number input

### Per-Server Backup Panel (requires active host connection)

- **Backup Now** button -> streams output in log panel (provision-style)
- **Snapshot table**: date, size, actions (restore / delete)
- **Restore** per snapshot -> confirmation dialog -> streams output

## Decisions

- **rsync over SSH** chosen over NFS/SSHFS/pull-based for minimal moving parts
- **Hub -> gateway -> backup host** (two-hop) chosen because hub already has gateway SSH access
- **Incremental hardlink snapshots** (`--link-dest`) for space efficiency
- **Global backup config** (one destination for all servers per tenant)
