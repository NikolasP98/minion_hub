import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { env } from '$env/dynamic/private';

/**
 * Compose a reminder's WhatsApp text. A deterministic Spanish template is the
 * source of truth; when `personalize` is on, the LLM rewrites it warmly — but we
 * ALWAYS fall back to the template on any error/timeout, so a message still goes
 * out. The template is also what unit tests assert against.
 */

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const REMINDER_MODEL = env.REMINDER_MODEL || env.CRM_SENTIMENT_MODEL || 'google/gemini-2.5-flash';

export interface ReminderContext {
  stage: string; // 'confirmation' | '24h' | '2h' | …
  attendeeName: string | null;
  serviceTitle: string;
  staffName: string | null;
  /** Appointment start, preformatted for the recipient (date + time, resource tz). */
  whenText: string;
  fromName: string;
  locale: string;
}

/**
 * Agent path: infer accept/decline from the contact's recent replies. Reads up
 * to a handful of inbound messages (newest last) and the appointment summary,
 * returns 'yes' | 'no' | 'unclear'. Falls back to 'unclear' on any error/no key,
 * so the booking simply stays pending and is re-scanned next tick.
 */
export async function inferConfirmationReply(
  messages: string[],
  about: { serviceTitle: string; whenText: string; locale: string },
): Promise<'yes' | 'no' | 'unclear'> {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey || !messages.length) return 'unclear';
  try {
    const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
    const prompt = [
      'A customer was asked to confirm an appointment. Read their recent messages and decide whether they are CONFIRMING attendance, DECLINING/cancelling, or it is UNCLEAR.',
      'They may not address it directly — infer from intent. If they want to reschedule or are unsure, answer UNCLEAR (do not guess).',
      `Appointment: ${about.serviceTitle} on ${about.whenText}.`,
      'Recent messages (oldest first):',
      ...messages.map((m, i) => `${i + 1}. ${m}`),
      '',
      'Answer with ONLY one word: YES, NO, or UNCLEAR.',
    ].join('\n');
    const res = await generateText({ model: openrouter(REMINDER_MODEL), prompt, temperature: 0 });
    const a = res.text.trim().toUpperCase();
    if (a.startsWith('YES')) return 'yes';
    if (a.startsWith('NO')) return 'no';
    return 'unclear';
  } catch {
    return 'unclear';
  }
}

/** A representative context for previewing a message in the settings UI. */
export function sampleContext(opts: { stage?: string; fromName?: string | null; locale?: string }): ReminderContext {
  const locale = opts.locale || 'es';
  const whenText =
    locale === 'es' ? 'martes, 24 de junio, 10:00 a. m.' : 'Tuesday, June 24, 10:00 AM';
  return {
    stage: opts.stage || 'confirmation',
    attendeeName: locale === 'es' ? 'Ana' : 'Ana',
    serviceTitle: locale === 'es' ? 'Consulta' : 'Consultation',
    staffName: locale === 'es' ? 'Dra. López' : 'Dr. López',
    whenText,
    fromName: opts.fromName?.trim() || (locale === 'es' ? 'tu negocio' : 'your business'),
    locale,
  };
}

/** Deterministic Spanish template per stage. Always safe to send. */
export function reminderTemplate(c: ReminderContext): string {
  const hi = c.attendeeName ? `Hola ${c.attendeeName} 👋` : 'Hola 👋';
  const con = c.staffName ? ` con ${c.staffName}` : '';
  const svc = c.serviceTitle;
  switch (c.stage) {
    case 'confirmation':
      return `${hi} Tu cita de ${svc}${con} en ${c.fromName} quedó agendada para el ${c.whenText}. ¡Te esperamos! Si necesitas reprogramar, escríbenos por aquí.`;
    case '2h':
      return `${hi} Te recordamos que tu cita de ${svc}${con} en ${c.fromName} es hoy a las ${c.whenText}. ¿Confirmas tu asistencia? 😊`;
    case '24h':
    default:
      return `${hi} Te recordamos tu cita de ${svc}${con} en ${c.fromName} para mañana, ${c.whenText}. ¿Confirmas tu asistencia? 😊`;
  }
}

/** Compose the message — template, optionally LLM-personalized (template fallback). */
export async function composeReminder(c: ReminderContext, personalize: boolean): Promise<string> {
  const base = reminderTemplate(c);
  if (!personalize) return base;
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return base;
  try {
    const openrouter = createOpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
    const prompt = [
      'Rewrite this appointment WhatsApp message so it sounds warm, natural and human, in the same language (Spanish).',
      'Keep it ONE short paragraph, keep all facts (service, person, date/time, business) exactly, keep at most one emoji,',
      'do not add links or placeholders, do not invent details. Return ONLY the message text.',
      '',
      `Message: ${base}`,
    ].join('\n');
    const res = await generateText({ model: openrouter(REMINDER_MODEL), prompt, temperature: 0.6 });
    const text = res.text.trim();
    // Guard against empty / runaway output — fall back to the template.
    if (text.length < 10 || text.length > 600) return base;
    return text;
  } catch {
    return base;
  }
}
