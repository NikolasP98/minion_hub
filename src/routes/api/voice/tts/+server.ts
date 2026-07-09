import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { env } from '$env/dynamic/private';
import { requireAuth } from '$server/auth/authorize';

/**
 * Text-to-speech for the "call my agent" feature on /home.
 *
 * POST { text, lang?: 'es' | 'en', voice? } -> audio/mpeg (mp3 bytes)
 *
 * Primary: ElevenLabs (when ELEVENLABS_API_KEY is set) — multilingual flash
 * model, same default voice as the gateway's TTS pipeline. Fallback: keyless
 * Microsoft Edge TTS (msedge-tts), which is also what runs when the key is
 * absent or the ElevenLabs call fails. The browser does STT in-page (Web
 * Speech API) and lip-syncs the OpenHuman avatar from the returned audio.
 */
const EDGE_VOICES: Record<string, string> = {
	es: 'es-ES-ElviraNeural',
	en: 'en-US-AvaNeural',
};
const DEFAULT_EDGE_VOICE = env.MA_TTS_VOICE ?? 'en-US-AvaNeural';
// Gateway's default ElevenLabs voice (minion/src/tts/tts.ts) so hub calls and
// channel voice notes sound the same.
const ELEVEN_VOICE = env.ELEVENLABS_VOICE_ID || 'pMsXgVXv3BLzUgSXRplE';
// flash v2.5: multilingual (es+en), lowest latency tier — right for a live call.
const ELEVEN_MODEL = env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5';

const mp3Response = (audio: Buffer) =>
	new Response(new Uint8Array(audio), {
		headers: {
			'Content-Type': 'audio/mpeg',
			'Content-Length': String(audio.length),
			'Cache-Control': 'no-store',
		},
	});

/** ElevenLabs synthesis — returns null (→ Edge fallback) if keyless or failed. */
async function elevenLabsTts(text: string, lang?: string): Promise<Response | null> {
	const key = env.ELEVENLABS_API_KEY || env.XI_API_KEY;
	if (!key) return null;
	const body: Record<string, unknown> = { text, model_id: ELEVEN_MODEL };
	// language_code enforcement is only supported by the turbo/flash v2.5 models.
	if (lang && /^eleven_(flash|turbo)/.test(ELEVEN_MODEL)) body.language_code = lang;
	try {
		const res = await fetch(
			`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_64`,
			{
				method: 'POST',
				headers: { 'xi-api-key': key, 'content-type': 'application/json' },
				body: JSON.stringify(body),
			},
		);
		if (!res.ok) {
			console.error('[voice/tts] elevenlabs', res.status, await res.text().catch(() => ''));
			return null;
		}
		return mp3Response(Buffer.from(await res.arrayBuffer()));
	} catch (err) {
		console.error('[voice/tts] elevenlabs error:', err);
		return null;
	}
}

export const POST: RequestHandler = async ({ locals, request }) => {
	requireAuth(locals);

	let body: { text?: unknown; voice?: unknown; lang?: unknown };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid json');
	}

	const text = String(body?.text ?? '').trim();
	if (!text) throw error(400, 'text required');
	const lang = body?.lang === 'es' || body?.lang === 'en' ? body.lang : undefined;

	const eleven = await elevenLabsTts(text, lang);
	if (eleven) return eleven;

	// Keyless Edge TTS fallback — pick a voice matching the requested language.
	const voice = String(body?.voice ?? (lang ? EDGE_VOICES[lang] : DEFAULT_EDGE_VOICE));
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

		return mp3Response(Buffer.concat(chunks));
	} catch (err) {
		console.error('[voice/tts] error:', err);
		throw error(502, 'tts_failed');
	}
};
