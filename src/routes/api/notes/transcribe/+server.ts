import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$server/auth/authorize';

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = env.NOTES_TRANSCRIBE_MODEL || 'whisper-1';
const MAX_BYTES = 25 * 1024 * 1024; // OpenAI's per-file limit

/**
 * POST /api/notes/transcribe  (multipart: file=<audio chunk>)
 *
 * Server-side speech-to-text for the "include machine/tab audio" path, where the
 * browser's Web Speech API can't help (it only listens to the default mic). The
 * client mixes mic + captured tab audio and posts short chunks here; we forward
 * each to OpenAI's transcription API and return the text to append.
 *
 * Mic-only transcription does NOT hit this route — it runs fully in-browser via
 * the Web Speech API (no key needed). This route is gated on a transcription key
 * and degrades gracefully (503) when it isn't configured.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAuth(locals);

  const apiKey = env.OPENAI_API_KEY || env.NOTES_TRANSCRIBE_API_KEY;
  if (!apiKey) {
    throw error(503, 'System-audio transcription needs OPENAI_API_KEY set on the hub.');
  }

  const inForm = await request.formData();
  const file = inForm.get('file');
  if (!(file instanceof File)) throw error(400, 'file is required');
  if (file.size > MAX_BYTES) throw error(413, 'Audio chunk too large.');
  if (file.size === 0) return json({ text: '' });

  const out = new FormData();
  out.append('file', file, file.name || 'audio.webm');
  out.append('model', MODEL);
  out.append('response_format', 'json');

  let res: Response;
  try {
    res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: out,
    });
  } catch {
    throw error(502, 'Transcription service unreachable.');
  }
  if (!res.ok) {
    throw error(502, `Transcription failed (${res.status}).`);
  }
  const data = (await res.json().catch(() => ({}))) as { text?: string };
  return json({ text: (data.text ?? '').trim() });
};
