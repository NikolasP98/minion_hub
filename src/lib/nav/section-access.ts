import { z } from 'zod';

export const SECTION_ACCESS_ACTIONS = [
  'view',
  'create',
  'edit',
  'delete',
  'export',
  'manage',
] as const;
export const sectionActionSetSchema = z
  .object({
    view: z.boolean(),
    create: z.boolean(),
    edit: z.boolean(),
    delete: z.boolean(),
    export: z.boolean(),
    manage: z.boolean(),
  })
  .strict();
export type SectionActionSet = z.infer<typeof sectionActionSetSchema>;
export const sectionAccessKindSchema = z.enum(['module', 'subresource', 'section', 'page']);
export type SectionAccessKind = z.infer<typeof sectionAccessKindSchema>;
export const sectionAccessTargetSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (key) =>
      /^(?:[a-z]+(?:\.[a-zA-Z0-9_-]+)*|section:[a-z0-9]{6}|page:[a-z0-9]{6}|page:\/[a-zA-Z0-9_/-]+)$/.test(
        key,
      ),
    'Invalid access target',
  );
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const explicitSchema = z
  .object({
    caps: sectionActionSetSchema,
    ifOwner: z.boolean(),
    fieldLevel: z.number().int().min(0).max(9),
  })
  .strict();
export const sectionAccessRoleSchema = z
  .object({
    key: z.string().min(1).max(256),
    name: z.string(),
    protected: z.boolean(),
    defaults: sectionActionSetSchema,
    effective: sectionActionSetSchema,
    effectiveIfOwner: z.boolean(),
    inheritedIfOwner: z.boolean(),
    effectiveFieldLevel: z.number().int().min(0),
    inheritedFieldLevel: z.number().int().min(0),
    explicit: explicitSchema.nullable(),
    revision: revisionSchema,
  })
  .strict();
export type SectionAccessRole = z.infer<typeof sectionAccessRoleSchema>;
export const sectionAccessSnapshotSchema = z
  .object({
    target: sectionAccessTargetSchema,
    label: z.string(),
    kind: sectionAccessKindSchema,
    orgName: z.string(),
    ownerScopable: z.boolean(),
    fieldScopable: z.boolean(),
    roles: z.array(sectionAccessRoleSchema),
  })
  .strict();
export type SectionAccessSnapshot = z.infer<typeof sectionAccessSnapshotSchema>;
export const sectionAccessWriteSchema = z
  .object({
    target: sectionAccessTargetSchema,
    roleKey: z.string().min(1).max(256),
    revision: revisionSchema,
    mode: z.enum(['inherit', 'deny', 'override']),
    caps: sectionActionSetSchema.optional(),
    ifOwner: z.boolean().optional(),
    fieldLevel: z.number().int().min(0).max(9).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'override' && !value.caps)
      ctx.addIssue({
        code: 'custom',
        path: ['caps'],
        message: 'Override requires all action values',
      });
    if (value.mode !== 'override' && value.caps !== undefined)
      ctx.addIssue({ code: 'custom', path: ['caps'], message: 'Caps apply only to override mode' });
    if (value.mode === 'inherit' && (value.ifOwner !== undefined || value.fieldLevel !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Inherited policy has no scope override' });
  });
export type SectionAccessWrite = z.infer<typeof sectionAccessWriteSchema>;
export const sectionAccessReceiptSchema = z
  .object({
    ok: z.literal(true),
    revision: revisionSchema,
    refreshRequired: z.literal(true).optional(),
    revisions: z.record(z.string(), revisionSchema).optional(),
    location: z.string().optional(),
  })
  .strict();
export type SectionAccessReceipt = z.infer<typeof sectionAccessReceiptSchema>;
export interface SectionAccessTarget {
  key: string;
  label: string;
  kind: SectionAccessKind;
  /** Stable structural definition used by conflict detection, never a caller-provided label. */
  definition: unknown;
  ownerScopable: boolean;
  fieldScopable: boolean;
}
