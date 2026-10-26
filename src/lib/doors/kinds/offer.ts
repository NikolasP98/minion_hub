import { z } from 'zod';

/** Offer door (spec 041 S6): a public price list picked from the catalog. */
export const kind = 'offer' as const;

export const configSchema = z
  .object({
    /** Catalog items (`fin_products.id`) shown, in this order. */
    productIds: z.array(z.string().uuid()).max(50),
    /** Free-form number; the public page only ever uses its digits. */
    whatsappNumber: z.string().trim().max(30).nullable(),
    /** `sched_links.id` behind the "Book" button. */
    bookingLinkId: z.string().uuid().nullable(),
  })
  .strict();

export type OfferConfig = z.infer<typeof configSchema>;

export const defaultConfig: OfferConfig = {
  productIds: [],
  whatsappNumber: null,
  bookingLinkId: null,
};

/** wa.me wants country code + digits only (E.164 without "+"); null when it can't be a number. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
