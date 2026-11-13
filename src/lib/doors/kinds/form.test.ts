import { describe, expect, it } from 'vitest';
import {
  buildSubmissionSchema,
  configSchema,
  contactFromValues,
  defaultConfig,
  fileIdsFromValues,
  profileFromValues,
  validateSubmission,
  type FormConfig,
} from './form';

// A FACES-style clinic intake: every fixed field type, clinical free text included.
const intake: FormConfig = {
  fields: [
    { key: 'nombre', label: 'Nombre completo', type: 'text', required: true },
    { key: 'telefono', label: 'Teléfono', type: 'phone', required: true },
    { key: 'email', label: 'Correo', type: 'email', required: false },
    { key: 'nacimiento', label: 'Fecha de nacimiento', type: 'date', required: true },
    {
      key: 'motivo',
      label: 'Motivo',
      type: 'select',
      required: true,
      options: ['Botox', 'Rellenos', 'Otro'],
    },
    { key: 'alergias', label: 'Alergias y medicamentos', type: 'textarea', required: false },
    { key: 'embarazo', label: '¿Está embarazada?', type: 'checkbox', required: false },
  ],
  consentText: 'Acepto el tratamiento de mis datos.',
  consentRequired: true,
};

const good = {
  nombre: ' Ana Prueba ',
  telefono: '+51 900 000 041',
  email: 'ANA@Example.com',
  nacimiento: '1990-05-01',
  motivo: 'Botox',
  alergias: 'Penicilina',
  embarazo: false,
};

describe('form configSchema', () => {
  it('accepts the default and a full clinic intake', () => {
    expect(configSchema.safeParse(defaultConfig).success).toBe(true);
    expect(configSchema.safeParse(intake).success).toBe(true);
  });

  it('defaults consentRequired to true', () => {
    const { consentRequired: _, ...rest } = intake;
    expect(configSchema.parse(rest).consentRequired).toBe(true);
  });

  it('names the problems the editor shows', () => {
    const msgs = (cfg: unknown) => {
      const r = configSchema.safeParse(cfg);
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(
      msgs({ ...intake, fields: [{ key: 'nombre', label: 'N', type: 'text', required: true }] }),
    ).toContain('needs_contact_field');
    expect(
      msgs({
        ...intake,
        fields: [...intake.fields, { key: 'x', label: 'X', type: 'select', required: false }],
      }),
    ).toContain('select_needs_options');
    expect(msgs({ ...intake, fields: [...intake.fields, intake.fields[0]] })).toContain(
      'duplicate_key',
    );
  });

  it('rejects bad keys, unknown types and extra props', () => {
    const field = (over: object) => ({ ...intake, fields: [intake.fields[1], over] });
    expect(
      configSchema.safeParse(field({ key: 'Bad Key', label: 'x', type: 'text', required: false }))
        .success,
    ).toBe(false);
    expect(
      configSchema.safeParse(field({ key: 'f', label: 'x', type: 'video', required: false }))
        .success,
    ).toBe(false);
    expect(configSchema.safeParse({ ...intake, extra: 1 }).success).toBe(false);
  });

  it('has no field cap: a 30-field clinical history is valid', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `f${i}`,
      label: 'x',
      type: 'phone' as const,
      required: false,
    }));
    expect(configSchema.safeParse({ ...intake, fields: many }).success).toBe(true);
  });
});

describe('validateSubmission', () => {
  it('accepts valid values, trims, lowercases email and drops unknown keys', () => {
    const r = validateSubmission(intake, { ...good, hacker: 'x', website: 'y' }, true);
    expect(r).toEqual({
      ok: true,
      values: { ...good, nombre: 'Ana Prueba', email: 'ana@example.com' },
    });
  });

  it('reports required fields and consent without echoing any value', () => {
    const r = validateSubmission(intake, { nombre: '  ', telefono: '' }, false);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      nombre: 'required',
      telefono: 'required',
      nacimiento: 'required',
      motivo: 'required',
      consent: 'required',
    });
  });

  it('flags malformed phone, email, date, select and over-long text as invalid', () => {
    const r = validateSubmission(
      intake,
      {
        ...good,
        telefono: 'call me <script>',
        email: 'nope',
        nacimiento: '01/05/1990',
        motivo: 'Liposucción',
        alergias: 'x'.repeat(2001),
      },
      true,
    );
    expect(r.ok ? {} : r.errors).toEqual({
      telefono: 'invalid',
      email: 'invalid',
      nacimiento: 'invalid',
      motivo: 'invalid',
      alergias: 'invalid',
    });
  });

  it('rejects impossible dates and non-string values', () => {
    const r = validateSubmission(intake, { ...good, nacimiento: '2026-02-31', nombre: 42 }, true);
    expect(r.ok ? {} : r.errors).toEqual({ nacimiento: 'invalid', nombre: 'invalid' });
  });

  it('a required checkbox must be ticked; an optional one defaults to false', () => {
    const cfg: FormConfig = {
      ...intake,
      fields: [
        intake.fields[1],
        { key: 'acepto', label: 'Acepto', type: 'checkbox', required: true },
        { key: 'extra', label: 'Extra', type: 'checkbox', required: false },
      ],
    };
    const base = { telefono: '900000041' };
    const no = validateSubmission(cfg, { ...base, acepto: false }, true);
    expect(no.ok ? {} : no.errors).toEqual({ acepto: 'required' });
    expect(validateSubmission(cfg, { ...base, acepto: true }, true)).toEqual({
      ok: true,
      values: { ...base, acepto: true, extra: false },
    });
  });

  it('skips consent when the door does not require it, and drops blank optionals', () => {
    const r = validateSubmission(
      { ...intake, consentRequired: false },
      { ...good, email: '', alergias: null },
      false,
    );
    expect(r.ok && r.values).not.toHaveProperty('email');
    expect(r.ok && r.values).not.toHaveProperty('alergias');
  });

  it('buildSubmissionSchema strips keys not in the config', () => {
    const parsed = buildSubmissionSchema({ fields: [intake.fields[1]] }).parse({
      telefono: '900000041',
      other: 'x',
    });
    expect(parsed).toEqual({ telefono: '900000041' });
  });
});

describe('profileFromValues', () => {
  const fields = [
    { key: 'dni', label: 'DNI', type: 'text' as const, required: false },
    { key: 'instagram', label: 'IG', type: 'text' as const, required: false },
    { key: 'tiktok', label: 'TikTok', type: 'text' as const, required: false },
    { key: 'facebook', label: 'FB', type: 'textarea' as const, required: false },
  ];
  it('normalizes DNI and handles, and ignores placeholders, blanks and non-text fields', () => {
    expect(
      profileFromValues(fields, {
        dni: ' 4567.8901 ',
        instagram: '@Ana.Prueba',
        tiktok: 'https://www.tiktok.com/@ana?lang=es',
        facebook: 'ana',
      }),
    ).toEqual({ dni: '45678901', instagram: 'ana.prueba', tiktok: 'ana' });
    expect(profileFromValues(fields, { dni: '11111111', instagram: ' ' })).toEqual({});
    expect(profileFromValues(fields, { dni: '1234567' })).toEqual({});
  });
});

describe('contactFromValues', () => {
  it('takes the name|nombre text field, the first phone and the first email', () => {
    expect(contactFromValues(intake.fields, { ...good, email: 'a@b.co' })).toEqual({
      name: ' Ana Prueba ',
      phone: '+51 900 000 041',
      email: 'a@b.co',
    });
    expect(contactFromValues([intake.fields[1]], { telefono: '900' })).toEqual({
      name: null,
      phone: '900',
      email: null,
    });
  });
});

describe('multiselect and file fields', () => {
  const FILE_A = 'a'.repeat(24);
  const FILE_B = 'b'.repeat(24);
  const casting: FormConfig = {
    fields: [
      { key: 'telefono', label: 'WhatsApp', type: 'phone', required: true },
      {
        key: 'tratamientos',
        label: 'Tratamientos',
        type: 'multiselect',
        required: true,
        options: ['Botox/Soft', 'Rino Sculpt', 'Slim Face'],
      },
      { key: 'foto', label: 'Foto frontal', type: 'file', required: true, accept: 'image' },
      { key: 'adjuntos', label: 'Adjuntos', type: 'file', required: false, maxFiles: 2 },
    ],
    consentText: 'Acepto.',
    consentRequired: true,
    tagIds: ['207440ff-2d42-4e5f-adf3-41f8e59f9601'],
  };
  const ok = {
    telefono: '+51 900 000 041',
    tratamientos: ['Slim Face', 'Botox/Soft'],
    foto: [FILE_A],
  };
  const errors = (values: object) => {
    const r = validateSubmission(casting, values, true);
    return r.ok ? {} : r.errors;
  };

  it('config: options are required for multiselect, tag ids must be uuids', () => {
    expect(configSchema.safeParse(casting).success).toBe(true);
    const noOptions = {
      ...casting,
      fields: [casting.fields[0], { ...casting.fields[1], options: [] }],
    };
    expect(configSchema.safeParse(noOptions).success).toBe(false);
    expect(configSchema.safeParse({ ...casting, tagIds: ['modelo'] }).success).toBe(false);
  });

  it('accepts option lists and file ids; blank optional lists are dropped', () => {
    const r = validateSubmission(casting, { ...ok, adjuntos: [] }, true);
    expect(r).toEqual({ ok: true, values: ok });
    expect(fileIdsFromValues(casting.fields, { ...ok, adjuntos: [FILE_B, FILE_A] })).toEqual([
      FILE_A,
      FILE_B,
    ]);
  });

  it('required lists must have an item; unknown options, bad ids, duplicates and too many files are invalid', () => {
    expect(errors({ ...ok, tratamientos: [], foto: undefined })).toEqual({
      tratamientos: 'required',
      foto: 'required',
    });
    expect(errors({ ...ok, tratamientos: ['Otra cosa'] })).toEqual({ tratamientos: 'invalid' });
    expect(errors({ ...ok, tratamientos: 'Slim Face' })).toEqual({ tratamientos: 'invalid' });
    expect(errors({ ...ok, tratamientos: ['Slim Face', 'Slim Face'] })).toEqual({
      tratamientos: 'invalid',
    });
    expect(errors({ ...ok, foto: ['../etc/passwd'] })).toEqual({ foto: 'invalid' });
    expect(errors({ ...ok, foto: [FILE_A, FILE_B] })).toEqual({ foto: 'invalid' });
    expect(errors({ ...ok, adjuntos: [FILE_A, FILE_B, 'c'.repeat(24)] })).toEqual({
      adjuntos: 'invalid',
    });
  });
});
