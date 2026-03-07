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
