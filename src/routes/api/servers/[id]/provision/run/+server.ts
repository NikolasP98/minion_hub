import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { serverProvisionConfigs } from '$server/db/schema';
import { requireAdmin } from '$server/auth/authorize';
import {
  getProvisionConfig,
  runSetupPhase,
  savePhaseStatuses,
  type PhaseStatus,
} from '$server/services/provision.service';
import { getPostHogClient } from '$lib/server/posthog';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
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

    const posthog = await getPostHogClient();
    posthog?.capture({
      distinctId: locals.user?.id ?? 'server',
      event: 'provision_run_started',
      properties: {
        server_id: params.id,
        ssh_host: config.sshHost,
        start_from: startFrom ?? null,
      },
    });

    const controller = new AbortController();
    const stream = runSetupPhase(config, startFrom, controller.signal);

    // Transform ReadableStream<string> into SSE format
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      async start(sseController) {
        const reader = stream.getReader();
        const liveStatuses: Record<string, PhaseStatus> = { ...config.phaseStatuses };
        let currentPhase: string | null = null;
        let exitCode: number | null = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Detect phase transitions from setup.sh output
            const phaseMatch = value.match(/[║|]\s*Phase\s+(\d+)/);
            if (phaseMatch) {
              // Mark previous phase complete if it was running
              if (currentPhase && liveStatuses[currentPhase] === 'running') {
                liveStatuses[currentPhase] = 'complete';
              }
              currentPhase = phaseMatch[1];
              liveStatuses[currentPhase] = 'running';
              sseController.enqueue(
                encoder.encode(`event: phase\ndata: ${JSON.stringify({ phase: currentPhase })}\n\n`),
              );
            }

            // Detect exit code from process
            const exitMatch = value.match(/\[Process exited with code (\d+)\]/);
            if (exitMatch) {
              exitCode = parseInt(exitMatch[1], 10);
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

          // Finalize last phase status based on exit code
          if (currentPhase) {
            if (exitCode === 0) {
              liveStatuses[currentPhase] = 'complete';
            } else if (liveStatuses[currentPhase] === 'running') {
              liveStatuses[currentPhase] = 'failed';
            }
          }

          // Save updated phase statuses and timestamp
          const now = Date.now();
          await savePhaseStatuses(ctx, params.id!, liveStatuses);
          await ctx.db
            .update(serverProvisionConfigs)
            .set({ lastProvisionAt: now, updatedAt: now })
            .where(eq(serverProvisionConfigs.serverId, params.id!));

          sseController.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
          sseController.close();
        } catch (err) {
          // Mark current phase as failed on error
          if (currentPhase && liveStatuses[currentPhase] === 'running') {
            liveStatuses[currentPhase] = 'failed';
          }
          await savePhaseStatuses(ctx, params.id!, liveStatuses).catch(() => {});

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
