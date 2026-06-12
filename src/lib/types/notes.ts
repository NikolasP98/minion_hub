// Shared note/todo/easel types + Zod schemas for the `data` JSON document.
//
// Importable by both the client state store and the server service. The DB row
// keeps a small scalar shell (id/kind/title/color/pinned/timestamps); the
// kind-specific body lives in the `data` JSON column validated here so the shape
// can grow without a migration.
//
// Images are NEVER stored inline — an Attachment / easel image item references a
// `fileId` in the Turso `files` table, rendered via `/api/files/<fileId>/raw`.

import { z } from 'zod';

export type NoteKind = 'note' | 'todo' | 'easel';
export const NOTE_KINDS = ['note', 'todo', 'easel'] as const;

export type NoteColor = 'default' | 'amber' | 'rose' | 'sky' | 'violet' | 'green';

/** An uploaded/re-hosted image bound to a note or todo card. */
export const attachmentSchema = z.object({
  id: z.string(),
  fileId: z.string(),
  w: z.number().nonnegative().default(0),
  h: z.number().nonnegative().default(0),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const todoItemSchema = z.object({
  id: z.string(),
  text: z.string().default(''),
  done: z.boolean().default(false),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

/** A single element placed on an Easel board. */
export const easelItemSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('image'),
    fileId: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    rotation: z.number().default(0),
    z: z.number().default(0),
  }),
  z.object({
    id: z.string(),
    type: z.literal('text'),
    text: z.string().default(''),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    rotation: z.number().default(0),
    z: z.number().default(0),
    color: z.string().optional(),
  }),
]);
export type EaselItem = z.infer<typeof easelItemSchema>;

export const cameraSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() });

// ─── Note blocks ───
//
// A `note`-kind note is a unified document: an ordered list of blocks. A block is
// a Markdown text segment, an embedded checklist, or an embedded easel board.
// Todos and easels are thus "elements embedded into a note" while still being
// structured data (a future task view can aggregate todo blocks across notes).

export const textBlockSchema = z.object({
  id: z.string(),
  type: z.literal('text'),
  md: z.string().default(''),
  attachments: z.array(attachmentSchema).default([]),
});
export const todoBlockSchema = z.object({
  id: z.string(),
  type: z.literal('todo'),
  title: z.string().optional(),
  items: z.array(todoItemSchema).default([]),
});
export const easelBlockSchema = z.object({
  id: z.string(),
  type: z.literal('easel'),
  title: z.string().optional(),
  items: z.array(easelItemSchema).default([]),
  camera: cameraSchema.optional(),
});
export const noteBlockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  todoBlockSchema,
  easelBlockSchema,
]);
export type TextBlock = z.infer<typeof textBlockSchema>;
export type TodoBlock = z.infer<typeof todoBlockSchema>;
export type EaselBlock = z.infer<typeof easelBlockSchema>;
export type NoteBlock = z.infer<typeof noteBlockSchema>;
export type NoteBlockType = NoteBlock['type'];

// ─── Per-kind `data` documents ───

export const noteDataSchema = z.object({
  body: z.string().default(''), // Markdown (Tiptap output) — legacy single-text note
  attachments: z.array(attachmentSchema).default([]),
  // Unified block document. When present it is the source of truth; `body` is kept
  // as a legacy/back-compat mirror of the first text block.
  blocks: z.array(noteBlockSchema).optional(),
  // Note icon: an emoji char, or `lucide:<Name>` for a built-in icon.
  icon: z.string().optional(),
});

export const todoDataSchema = z.object({
  items: z.array(todoItemSchema).default([]),
  attachments: z.array(attachmentSchema).default([]),
});

export const easelDataSchema = z.object({
  items: z.array(easelItemSchema).default([]),
  camera: z
    .object({ x: z.number(), y: z.number(), zoom: z.number().positive() })
    .optional(),
});

export type NoteData = z.infer<typeof noteDataSchema>;
export type TodoData = z.infer<typeof todoDataSchema>;
export type EaselData = z.infer<typeof easelDataSchema>;
export type NoteDocument = NoteData | TodoData | EaselData;

/**
 * Parse + normalize a raw `data` value (object or JSON string) for a given kind.
 * Tolerant: unknown/missing fields fall back to defaults (mirrors the spirit of
 * the old client `normalize()`), so legacy/corrupt rows never throw.
 */
export function parseNoteData(kind: NoteKind, raw: unknown): NoteDocument {
  const obj = typeof raw === 'string' ? safeJson(raw) : (raw ?? {});
  switch (kind) {
    case 'todo':
      return todoDataSchema.catch({ items: [], attachments: [] }).parse(obj);
    case 'easel':
      return easelDataSchema.catch({ items: [] }).parse(obj);
    case 'note':
    default:
      return noteDataSchema.catch({ body: '', attachments: [] }).parse(obj);
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/** The default `data` document for a freshly-created note of a given kind. */
export function defaultNoteData(kind: NoteKind): NoteDocument {
  switch (kind) {
    case 'todo':
      return { items: [], attachments: [] };
    case 'easel':
      return { items: [] };
    case 'note':
    default:
      return { body: '', attachments: [] };
  }
}
