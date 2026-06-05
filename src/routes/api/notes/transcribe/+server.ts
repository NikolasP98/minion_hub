import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$server/auth/authorize';
import { gatewayCall } from '$lib/server/gateway-rpc';

const MODEL = env.NOTES_TRANSCRIBE_MODEL || 'whisper-1';
const MAX_BYTES = 25 * 1024 * 1024; // OpenAI's per-file limit

/**
 * POST /api/notes/transcribe  (multipart: file=<audio chunk>)
 *
 * Server-side speech-to-text for the "include machine/tab audio" path, where the
 * browser's Web Speech API can't help (it only listens to the default mic). The
 * client mixes mic + captured tab audio and posts short chunks here.
 *
 * The hub holds no STT key — it forwards each chunk (base64) to the gateway's
 * `media.transcribe` RPC, which runs whisper over the gateway's own OpenAI
 * credentials. Mic-only transcription does NOT hit this route (it's in-browser
 * Web Speech). Degrades gracefully (502) when the gateway/STT is unavailable.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);

  const inForm = await request.formData();
  const file = inForm.get('file');
  if (!(file instanceof File)) throw error(400, 'file is required');
  if (file.size > MAX_BYTES) throw error(413, 'Audio chunk too large.');
  if (file.size === 0) return json({ text: '' });

  const audioBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  try {
    const res = await gatewayCall<{ text?: string }>(
      'media.transcribe',
      {
        audioBase64,
        mimeType: file.type || 'audio/webm',
        fileName: file.name || 'audio.webm',
        model: MODEL,
      },
      { timeoutMs: 60_000 },
    );
    return json({ text: (res.text ?? '').trim() });
  } catch {
    throw error(502, 'Transcription is unavailable right now.');
  }
};
