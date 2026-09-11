import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import {
  PHASES,
  getProvisionConfig,
  runSetupPhase,
  savePhaseStatuses,
  markProvisionRun,
  type PhaseStatus,
} from '$server/services/provision.service';
import { captureServerEvent } from '$lib/server/posthog';
import { requestIdentity, distinctIdFor, correlationId } from '$lib/server/observability-context';

export const POST: RequestHandler = async ({ locals, params, request, route }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  try {
    const config = await getProvisionConfig(ctx, params.id!);
    if (!config?.sshHost) {
      return json({ ok: false, error: 'No SSH host configured for this server' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const startFrom = (body as { startFrom?: string }).startFrom;

    try {
      const identity = requestIdentity({
        routeId: route.id,
        method: request.method,
        headers: request.headers,
        locals,
      });
      captureServerEvent({
        distinctId: distinctIdFor(identity),
        event: 'provision_run_started',
        properties: {
          ...identity,
          server_id: correlationId('server', params.id),
          start_from: PHASES.some((phase) => phase.id === startFrom) ? startFrom : null,
        },
      });
    } catch {
      // Telemetry metadata must not change the application outcome.
    }

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
                encoder.encode(
                  `event: phase\ndata: ${JSON.stringify({ phase: currentPhase })}\n\n`,
                ),
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
          await savePhaseStatuses(ctx, params.id!, liveStatuses);
          await markProvisionRun(ctx, params.id!);

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
    // TODO(handoff): host error-log scrubbing is separate from the sanitized
    // PostHog boundary; review this payload under meta-repo
    // proposals/2026-09-11-hub-telemetry-boundary-followups.md.
    console.error(`[POST /api/servers/${params.id}/provision/run]`, e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
