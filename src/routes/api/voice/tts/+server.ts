import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { env } from '$env/dynamic/private';

/**
 * Keyless text-to-speech for the "call my agent" feature on /my-agent.
 *
 * POST { text, voice? } -> audio/mpeg (mp3 bytes)
 *
 * Uses Microsoft Edge TTS (msedge-tts) — no API key required. The browser
 * does STT in-page (Web Speech API) and lip-syncs the OpenHuman avatar from
 * the amplitude/visemes of the returned audio (wawa-lipsync). The agent's
 * reply itself comes from the gateway chat.send path (same agent prompt,
 * tools and context as text chat), so this route only synthesizes speech.
 *
 * Ported from the meeting-agent demo backend
 * (.claude/worktrees/meeting-agent-demo/meeting-agent/server/index.ts).
 */
const DEFAULT_VOICE = env.MA_TTS_VOICE ?? 'en-US-AvaNeural';

export const POST: RequestHandler = async ({ request }) => {
  let body: { text?: unknown; voice?: unknown };
  try {
    body = await request.json();
  } catch {
    throw error(400, 'invalid json');
  }

  const text = String(body?.text ?? '').trim();
  const voice = String(body?.voice ?? DEFAULT_VOICE);
  if (!text) throw error(400, 'text required');

  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    // msedge-tts v2: toStream is async and returns { audioStream, metadataStream }.
    const { audioStream } = await tts.toStream(text);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      audioStream.on('end', () => resolve());
      audioStream.on('error', reject);
    });

    const audio = Buffer.concat(chunks);
    return new Response(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[voice/tts] error:', err);
    throw error(502, 'tts_failed');
  }
};
