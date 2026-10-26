import { z } from 'zod';

/**
 * Where a visitor came from when they reached a door (spec 041 FR-003).
 * Captured server-side on the public page load, carried in the submit/book
 * body, and re-validated with `attributionSchema` at the endpoint. Pure and
 * isomorphic: no PII (no IP, user agent, path or query of the referer).
 */
export type DoorKey = `book:${string}` | `door:${string}`;

export interface Attribution {
  door: DoorKey;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  /** Host only, never path or query. Null/absent for our own host. */
  referrer_host?: string;
  /** ISO timestamp, server time of capture. */
  at: string;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
const MAX = 100;

const clip = (v: string | null | undefined): string | undefined => {
  const s = v?.trim().slice(0, MAX);
  return s ? s : undefined;
};

export function parseAttribution(
  url: URL,
  referer: string | null,
  ownHost: string,
  door: DoorKey,
  now: Date = new Date(),
): Attribution {
  const out: Attribution = { door, at: now.toISOString() };
  for (const key of UTM_KEYS) {
    const v = clip(url.searchParams.get(key));
    if (v) out[key] = v;
  }
  if (referer) {
    try {
      const host = new URL(referer).host.toLowerCase();
      if (host && host !== ownHost.toLowerCase()) out.referrer_host = host.slice(0, MAX);
    } catch {
      /* malformed referer: ignore */
    }
  }
  return out;
}

const bounded = z.string().trim().min(1).max(MAX).optional();

/** Strict re-validation of a client-carried attribution (unknown keys → 400). */
export const attributionSchema = z
  .object({
    door: z.custom<DoorKey>((v) => typeof v === 'string' && /^(book|door):[0-9a-f-]{36}$/i.test(v)),
    utm_source: bounded,
    utm_medium: bounded,
    utm_campaign: bounded,
    referrer_host: bounded,
    at: z.string().datetime(),
  })
  .strict();
