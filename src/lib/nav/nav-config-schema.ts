import { z } from 'zod';
import type { NavConfig } from './custom-sections';

const id = z.string().regex(/^[a-z0-9]{6}$/);

const pageSchema = z.object({
  id,
  kind: z.enum(['link', 'main']),
  slug: z.string().min(1).max(32),
  label: z.string().min(1).max(80),
  icon: z.string().max(40).optional(),
  target: z.string().min(1).max(200),
  hidden: z.literal(true).optional(),
});

const sectionSchema = z.object({
  id,
  slug: z.string().min(1).max(32),
  label: z.string().min(1).max(80),
  icon: z.string().max(40).optional(),
  hidden: z.literal(true).optional(),
  pages: z.array(pageSchema).max(100),
});

/** Structural checks only; semantic rules live in `validateNavConfig`. */
export const navConfigSchema = z.object({
  version: z.literal(1),
  sections: z.array(sectionSchema).max(100),
  builtinSections: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.array(pageSchema).max(30)),
  builtin: z.record(
    z.string().min(1).max(200),
    z.object({ label: z.string().min(1).max(80).optional(), hidden: z.literal(true).optional() }),
  ),
});

export function isNavConfig(value: unknown): value is NavConfig {
  return navConfigSchema.safeParse(value).success;
}
