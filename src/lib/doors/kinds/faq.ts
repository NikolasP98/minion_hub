import { z } from 'zod';

/** FAQ door (spec 041 FR-010/FR-011): owner-approved answers to real customer questions. */
export const kind = 'faq' as const;

export const FAQ_MAX_ENTRIES = 50;
export const FAQ_Q_MAX = 300;
export const FAQ_A_MAX = 2000;

const entrySchema = z
  .object({
    id: z.string().min(1).max(64),
    q: z.string().trim().min(1).max(FAQ_Q_MAX),
    // A draft may have no answer yet (the model found no business reply); approving needs one.
    a: z.string().trim().max(FAQ_A_MAX),
    status: z.enum(['draft', 'approved']),
  })
  .strict()
  .refine((e) => e.status === 'draft' || e.a.length > 0, {
    message: 'approved entries need an answer',
    path: ['a'],
  });

export const configSchema = z
  .object({
    entries: z
      .array(entrySchema)
      .max(FAQ_MAX_ENTRIES)
      .refine((list) => new Set(list.map((e) => e.id)).size === list.length, {
        message: 'entry ids must be unique',
      }),
    whatsappNumber: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{6,15}$/)
      .optional(),
  })
  .strict();

export type FaqConfig = z.infer<typeof configSchema>;
export type FaqEntry = FaqConfig['entries'][number];

export const defaultConfig: FaqConfig = { entries: [] };

/** What `/d/<slug>` receives: approved entries only, never drafts. */
export interface FaqPublicData {
  entries: Array<{ q: string; a: string }>;
  whatsappNumber: string | null;
}

/**
 * FAQPage JSON-LD for a `<script type="application/ld+json">` body. `<` is
 * escaped so an answer containing `</script>` cannot close the tag.
 */
export function faqJsonLd(entries: FaqPublicData['entries']): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entries.map((e) => ({
      '@type': 'Question',
      name: e.q,
      acceptedAnswer: { '@type': 'Answer', text: e.a },
    })),
  }).replace(/</g, '\\u003c');
}
