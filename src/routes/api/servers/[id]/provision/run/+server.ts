import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import {
  getProvisionConfig,
  runSetupPhase,
  savePhaseStatuses,
} from '$server/services/provision.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const config = await getProvisionConfig(ctx, params.id!);
    if (!config?.sshHost) {
      return json(
        { ok: false, error: 'No SSH host configured for this server' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const startFrom = (body as { startFrom?: string }).startFrom;

    const controller = new AbortController();
    const stream = runSetupPhase(config, startFrom, controller.signal);

    // Transform ReadableStream<string> into SSE format
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      async start(sseController) {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Detect phase transitions from setup.sh output
            const phaseMatch = value.match(/={3,}\s*Phase\s+(\d+)/i);
            if (phaseMatch) {
              sseController.enqueue(
                encoder.encode(`event: phase\ndata: ${JSON.stringify({ phase: phaseMatch[1] })}\n\n`),
              );
            }

            // Send log lines
            const lines = value.split('\n');
            for (const line of lines) {
              if (line.length > 0) {
                sseController.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'log', line })}\n\n`),
                );
              }
            }
          }

          // Save final timestamp
          await savePhaseStatuses(ctx, params.id!, config.phaseStatuses);

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
  } catch (e) {
    console.error(`[POST /api/servers/${params.id}/provision/run]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
