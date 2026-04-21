import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model routing: which provider + API method to use
const MODEL_CONFIG: Record<
  string,
  { provider: 'gemini' | 'openrouter'; method?: 'generateContent' | 'predict' }
> = {
  'gemini-2.5-flash-image': { provider: 'gemini', method: 'generateContent' },
  'gemini-3.1-flash-image-preview': { provider: 'gemini', method: 'generateContent' },
  'gemini-3-pro-image-preview': { provider: 'gemini', method: 'generateContent' },
  'imagen-4.0-fast-generate-001': { provider: 'gemini', method: 'predict' },
  'imagen-4.0-generate-001': { provider: 'gemini', method: 'predict' },
  'imagen-4.0-ultra-generate-001': { provider: 'gemini', method: 'predict' },
  'openai/gpt-5-image-mini': { provider: 'openrouter' },
  'openai/gpt-5-image': { provider: 'openrouter' },
};
const DEFAULT_MODEL = 'openai/gpt-5-image-mini';

// Simple in-memory rate limiter: 20 requests per minute per IP
const rateBuckets = new Map<string, number[]>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateBuckets.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

// Periodically clean stale entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateBuckets) {
    const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, recent);
  }
}, 300_000);

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const ip = getClientAddress();
  if (!checkRateLimit(ip)) throw error(429, 'Too many requests. Please wait a moment.');

  const body = await request.json().catch(() => null);
  if (!body?.prompt || typeof body.prompt !== 'string') {
    throw error(400, 'Missing or invalid prompt');
  }

  const model = body.model || DEFAULT_MODEL;
  const config = MODEL_CONFIG[model];
  if (!config) throw error(400, 'Invalid model');

  const imageSize = body.resolution || '1K';

  try {
    let imageBase64: string | null = null;
    let imageMime = 'image/png';
    let textResponse = '';

    if (config.provider === 'openrouter') {
      // ── OpenRouter (GPT-5 Image models) ──
      const orKey = env.OPENROUTER_API_KEY;
      if (!orKey) throw error(500, 'OpenRouter API key not configured');

      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${orKey}`,
          'HTTP-Referer': 'https://minionhub.admin-console.dev',
          'X-Title': 'Minion Hub Image Studio',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: body.prompt }],
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error('[studio/generate] OpenRouter error:', res.status, errBody);
        throw error(502, 'Image generation service error');
      }

      const data = await res.json();
      const msg = data?.choices?.[0]?.message;

      // GPT-5 Image returns images in message.images[] as data URIs
      const images = msg?.images as
        | Array<{ type: string; image_url?: { url: string } }>
        | undefined;
      if (images?.length) {
        for (const img of images) {
          if (img.image_url?.url?.startsWith('data:')) {
            const match = img.image_url.url.match(/^data:(image\/[^;]+);base64,(.+)$/s);
            if (match) {
              imageMime = match[1];
              imageBase64 = match[2];
              break;
            }
          }
        }
      }

      if (typeof msg?.content === 'string' && msg.content) {
        textResponse = msg.content;
      }
    } else if (config.method === 'predict') {
      // ── Imagen (predict endpoint) ──
      const geminiKey = env.GEMINI_API_KEY;
      if (!geminiKey) throw error(500, 'Gemini API key not configured');

      const res = await fetch(`${GEMINI_BASE}/${model}:predict?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: body.prompt }],
          parameters: { sampleCount: 1 },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error('[studio/generate] Imagen API error:', res.status, errBody);
        const isQuota = errBody.includes('quota') || errBody.includes('billing');
        throw error(
          502,
          isQuota ? 'Imagen requires a paid Google AI plan' : 'Image generation service error',
        );
      }

      const data = await res.json();
      const prediction = data?.predictions?.[0];
      if (prediction?.bytesBase64Encoded) {
        imageBase64 = prediction.bytesBase64Encoded;
        imageMime = prediction.mimeType || 'image/png';
      }
    } else {
      // ── Gemini (generateContent endpoint) ──
      const geminiKey = env.GEMINI_API_KEY;
      if (!geminiKey) throw error(500, 'Gemini API key not configured');

      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: body.prompt }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: { imageSize },
          },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        console.error('[studio/generate] Gemini API error:', res.status, errBody);
        const isQuota = errBody.includes('quota') || errBody.includes('billing');
        throw error(
          502,
          isQuota
            ? 'Gemini image generation requires a paid Google AI plan'
            : 'Image generation service error',
        );
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (!parts || !Array.isArray(parts)) {
        throw error(502, 'Unexpected response from image generation service');
      }

      for (const part of parts) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
          imageBase64 = part.inlineData.data;
          imageMime = part.inlineData.mimeType;
        } else if (part.text) {
          textResponse += part.text;
        }
      }
    }

    if (!imageBase64) {
      throw error(422, 'No image was generated. Try adjusting your settings or prompt.');
    }

    return json({
      image: { base64: imageBase64, mimeType: imageMime },
      text: textResponse || null,
    });
  } catch (err) {
    // Re-throw SvelteKit errors
    if (err && typeof err === 'object' && 'status' in err) throw err;
    console.error('[studio/generate] Unexpected error:', err);
    throw error(502, 'Image generation failed');
  }
};
