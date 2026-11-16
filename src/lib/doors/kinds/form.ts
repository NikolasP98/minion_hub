import { z } from 'zod';
import type { Attribution } from '../attribution';

/**
 * Form door (spec 041 S2): a public intake form whose submissions land in the
 * org's CRM. Isomorphic: the server validates against `buildSubmissionSchema`
 * at the trust boundary, and the public page runs the same schema to show
 * inline errors before posting.
 */
export const kind = 'form' as const;

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'phone',
  'email',
  'select',
  'date',
  'checkbox',
  'multiselect',
  'file',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_MAX_OPTIONS = 20;
export const FORM_MAX_VALUE = 2000;
export const FORM_MAX_FILES = 10;
export const FORM_MAX_TAGS = 10;
/** What a `file` field with `accept: 'image'` takes (a subset of the attachment allowlist). */
export const FORM_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/gif',
];
/** A `files.id` (cuid2) as the upload endpoint returns it. */
const FILE_ID_RE = /^[a-z0-9]{16,40}$/;
export const FORM_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const PHONE_RE = /^[+0-9 ()-]{6,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fieldSchema = z
  .object({
    key: z.string().regex(FORM_KEY_RE),
    label: z.string().trim().min(1).max(200),
    type: z.enum(FORM_FIELD_TYPES),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(100)).max(FORM_MAX_OPTIONS).optional(),
    /** `file` only: 'image' narrows uploads to FORM_IMAGE_TYPES (default: any allowed attachment). */
    accept: z.enum(['image', 'any']).optional(),
    /** `file` only: how many files the answer may hold (default 1). */
    maxFiles: z.number().int().min(1).max(FORM_MAX_FILES).optional(),
  })
  .strict();

export type FormField = z.infer<typeof fieldSchema>;

/** Problems the editor names in plain words (the `message` of each issue). */
export type FormConfigProblem = 'duplicate_key' | 'select_needs_options' | 'needs_contact_field';

export const configSchema = z
  .object({
    fields: z.array(fieldSchema).min(1),
    consentText: z.string().trim().min(1).max(1000),
    consentRequired: z.boolean().default(true),
    successMessage: z.string().trim().max(500).optional(),
    /** Manual customer tags put on the contact of every submission (new or matched). */
    tagIds: z.array(z.string().uuid()).max(FORM_MAX_TAGS).optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    cfg.fields.forEach((f, i) => {
      if (seen.has(f.key))
        ctx.addIssue({ code: 'custom', path: ['fields', i, 'key'], message: 'duplicate_key' });
      seen.add(f.key);
      if ((f.type === 'select' || f.type === 'multiselect') && !f.options?.length)
        ctx.addIssue({
          code: 'custom',
          path: ['fields', i, 'options'],
          message: 'select_needs_options',
        });
    });
    // Without a phone or email the visitor cannot be matched to or become a contact.
    if (!cfg.fields.some((f) => f.type === 'phone' || f.type === 'email'))
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'needs_contact_field' });
  });

export type FormConfig = z.infer<typeof configSchema>;

/** Public paths: a config this build cannot read (e.g. keys from a newer release) is "no door", never a 500. */
export function readFormConfig(raw: unknown): FormConfig | null {
  const r = configSchema.safeParse(raw);
  return r.success ? r.data : null;
}

// shortcut: default labels are Spanish (FACES is the first user); the owner edits them.
export const defaultConfig: FormConfig = {
  fields: [
    { key: 'nombre', label: 'Nombre completo', type: 'text', required: true },
    { key: 'telefono', label: 'Teléfono', type: 'phone', required: true },
    { key: 'email', label: 'Correo', type: 'email', required: false },
  ],
  consentText: 'Acepto que usen mis datos para contactarme sobre mi consulta.',
  consentRequired: true,
};

/** What `publicView` hands the anonymous page: the form shape, nothing else. */
export type FormPublicData = Pick<FormConfig, 'fields' | 'consentText' | 'consentRequired'> & {
  successMessage: string | null;
};

/** Field error codes. Never carries the value, so it can be returned to anyone. */
export type FieldErrorCode = 'required' | 'invalid';

/** `YYYY-MM-DD` that names a real day (Date rolls 2026-02-31 over to March). */
const isRealDate = (v: string) => {
  const t = Date.parse(`${v}T00:00:00Z`);
  return DATE_RE.test(v) && !Number.isNaN(t) && new Date(t).toISOString().startsWith(v);
};
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
const err = (iss: { input?: unknown }) => (blank(iss.input) ? 'required' : 'invalid');

function valueSchema(field: FormField): z.ZodType {
  if (field.type === 'checkbox') {
    const box = z.boolean({ error: 'invalid' });
    return field.required
      ? box.refine((v) => v, { message: 'required' })
      : z.preprocess((v) => v ?? false, box);
  }
  if (field.type === 'multiselect' || field.type === 'file') {
    const options = field.options ?? [];
    const item =
      field.type === 'file'
        ? z.string().regex(FILE_ID_RE)
        : z.string().refine((v) => options.includes(v));
    const max = field.type === 'file' ? (field.maxFiles ?? 1) : FORM_MAX_OPTIONS;
    const list = z
      .array(item, { error: err })
      .max(max, 'invalid')
      .refine((v) => new Set(v).size === v.length, 'invalid');
    // [] / null mean "not answered", like '' for text.
    return z.preprocess(
      (v) => (v === null || (Array.isArray(v) && !v.length) ? undefined : v),
      field.required ? list : list.optional(),
    );
  }
  let s = z.string({ error: err }).trim().min(1, 'required').max(FORM_MAX_VALUE, 'invalid');
  if (field.type === 'phone') s = s.regex(PHONE_RE, 'invalid');
  if (field.type === 'email') s = s.toLowerCase().email('invalid').max(320, 'invalid');
  if (field.type === 'date') s = s.refine(isRealDate, 'invalid');
  if (field.type === 'select') {
    const options = field.options ?? [];
    s = s.refine((v) => options.includes(v), 'invalid');
  }
  // '' / null mean "not answered": absent for optional fields, 'required' otherwise.
  return z.preprocess((v) => (blank(v) ? undefined : v), field.required ? s : s.optional());
}

/** Zod schema for one submission's values; unknown keys are dropped. */
export function buildSubmissionSchema(config: Pick<FormConfig, 'fields'>) {
  return z.object(Object.fromEntries(config.fields.map((f) => [f.key, valueSchema(f)])));
}

export type SubmissionValues = Record<string, string | boolean | string[]>;

/** The uploaded file ids a validated submission carries, across every `file` field. */
export function fileIdsFromValues(fields: FormField[], values: SubmissionValues): string[] {
  const ids = fields.flatMap((f) => {
    const v = values[f.key];
    return f.type === 'file' && Array.isArray(v) ? v : [];
  });
  return [...new Set(ids)];
}

/** Validates values and consent; errors are per-field codes (`consent` for the checkbox). */
export function validateSubmission(
  config: Pick<FormConfig, 'fields' | 'consentRequired'>,
  values: unknown,
  consent: boolean,
): { ok: true; values: SubmissionValues } | { ok: false; errors: Record<string, FieldErrorCode> } {
  const parsed = buildSubmissionSchema(config).safeParse(values ?? {});
  const errors: Record<string, FieldErrorCode> = {};
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !errors[key]) errors[key] = issue.message === 'required' ? 'required' : 'invalid';
    }
  if (config.consentRequired && !consent) errors.consent = 'required';
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };
  // Optional fields left blank are dropped rather than stored as undefined.
  const clean = Object.fromEntries(
    Object.entries(parsed.data as Record<string, unknown>).filter(([, v]) => v !== undefined),
  ) as SubmissionValues;
  return { ok: true, values: clean };
}

/** Who the submission is about: first name-like text field, first phone, first email. */
export function contactFromValues(
  fields: FormField[],
  values: SubmissionValues,
): { name: string | null; phone: string | null; email: string | null } {
  const first = (pred: (f: FormField) => boolean) => {
    const f = fields.find((x) => pred(x) && typeof values[x.key] === 'string');
    return f ? (values[f.key] as string) : null;
  };
  return {
    name: first((f) => f.type === 'text' && /^(name|nombre)$/.test(f.key)),
    phone: first((f) => f.type === 'phone'),
    email: first((f) => f.type === 'email'),
  };
}

/** Form keys whose answers also land on the CRM contact (`custom_fields`). Never clinical text. */
export const PROFILE_KEYS = ['dni', 'instagram', 'tiktok', 'facebook'] as const;
export type ContactProfile = Partial<Record<(typeof PROFILE_KEYS)[number], string>>;

/** DNI/CE as a dedup key: placeholders ('00000000', < 8 chars) are not keys (same rule as party.service). */
const cleanDoc = (v: string) => {
  const d = v
    .trim()
    .toUpperCase()
    .replace(/[\s.-]/g, '');
  return d.length < 8 || /^(.)\1*$/.test(d) ? null : d;
};
/** '@Ana.Prueba', 'instagram.com/ana.prueba/' → 'ana.prueba'. */
const cleanHandle = (v: string) =>
  v
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?[a-z]+\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase() || null;

/** The DNI and social handles a submission carries, normalized for the contact. */
export function profileFromValues(fields: FormField[], values: SubmissionValues): ContactProfile {
  const out: ContactProfile = {};
  for (const key of PROFILE_KEYS) {
    const v = values[key];
    if (typeof v !== 'string' || !fields.some((f) => f.key === key && f.type === 'text')) continue;
    const clean = key === 'dni' ? cleanDoc(v) : cleanHandle(v);
    if (clean) out[key] = clean;
  }
  return out;
}

/** One submission as the staff panel reads it (`GET /api/crm/doors/[id]/submissions`). */
export interface SubmissionRow {
  id: string;
  createdAt: string;
  contactId: string | null;
  contactName: string | null;
  consent: boolean;
  values: Record<string, unknown>;
  attribution: Pick<Attribution, 'utm_source' | 'utm_medium' | 'utm_campaign' | 'referrer_host'>;
}
