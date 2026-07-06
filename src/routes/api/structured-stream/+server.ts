import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { streamObject } from 'ai';
import { env } from '$env/dynamic/private';
import { hubBaseUrl } from '$server/config/urls';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { SCHEMA_MAP, type SchemaType } from '$lib/schemas/structured-response';
import { getOpenRouterModel } from '$server/llm';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

/**
 * POST /api/structured-stream
 * Body: { type: SchemaType, prompt: string, model?: string }
 *
 * Returns an NDJSON stream of partial structured objects.
 * Each line: { partial: <partial object per schema>, done: false }
 * Final line: { partial: <complete object>, done: true }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  if (!ctx) throw error(401, 'Unauthorized');

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw error(503, 'No AI API key configured');

  const body = await request.json();
  const { type, prompt, model } = body as { type: SchemaType; prompt: string; model?: string };

  if (!type || !SCHEMA_MAP[type]) {
    throw error(400, `Invalid type. Must be one of: ${Object.keys(SCHEMA_MAP).join(', ')}`);
  }
  if (!prompt || typeof prompt !== 'string') {
    throw error(400, 'prompt is required');
  }

  const schema = SCHEMA_MAP[type];
  const selectedModel = model || DEFAULT_MODEL;

  const result = streamObject({
    model: getOpenRouterModel(selectedModel),
    schema,
    prompt,
    headers: {
      'HTTP-Referer': hubBaseUrl(),
      'X-Title': 'Minion Hub - Structured Stream',
    },
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const partial of result.partialObjectStream) {
          const line = JSON.stringify({ partial, done: false }) + '\n';
          controller.enqueue(encoder.encode(line));
        }
        const finalObject = await result.object;
        const doneLine = JSON.stringify({ partial: finalObject, done: true }) + '\n';
        controller.enqueue(encoder.encode(doneLine));
      } catch (err) {
        const errLine =
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Stream failed',
            done: true,
          }) + '\n';
        controller.enqueue(encoder.encode(errLine));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
