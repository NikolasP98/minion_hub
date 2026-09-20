/**
 * Tag scopes — each category owns its tags; they are never interchangeable
 * (owner directive 2026-09-19). A tag row (`crm_tags.scope`) belongs to exactly
 * one scope and can only be applied to entities of that scope. Inheritance is
 * read-time only: recipes/products inherit their ingredients' STOCK tags, and
 * events show their client's CRM tags and their service's CATALOG tags next to
 * their own EVENT tags — none of those are copied into the other scope.
 */
export const TAG_SCOPES = ['crm', 'stock', 'catalog', 'event'] as const;
export type TagScope = (typeof TAG_SCOPES)[number];

export function isTagScope(v: unknown): v is TagScope {
  return typeof v === 'string' && (TAG_SCOPES as readonly string[]).includes(v);
}

/** Entities that carry tags through the polymorphic `tag_links` table.
 *  Contacts keep their own `crm_contact_tags` (scope `crm`). */
export type TagEntityKind = 'booking' | 'event_type' | 'product' | 'item';

export const TAG_SCOPE_OF_KIND: Record<TagEntityKind, TagScope> = {
  booking: 'event',
  event_type: 'catalog',
  product: 'catalog',
  item: 'stock',
};

/** Hub module whose `view`/`edit` capabilities gate a scope's tag registry. */
export const TAG_SCOPE_MODULE = {
  crm: 'crm',
  stock: 'stock',
  catalog: 'pos',
  event: 'scheduling',
} as const satisfies Record<TagScope, string>;
