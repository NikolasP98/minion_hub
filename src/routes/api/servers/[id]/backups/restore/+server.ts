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
