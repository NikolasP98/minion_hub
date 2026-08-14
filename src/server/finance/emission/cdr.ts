import type { CdrResult } from './types';
import { unzipToText } from './zip';

/** Namespace-agnostic single-tag text extractor (same approach as soap.ts — the
 * CDR ApplicationResponse is small and well-known, no need for a full XML parser). */
function extractTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`));
  return m ? m[1].trim() : null;
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1].trim());
}

/** Unzips SUNAT's CDR (`R-*.xml`) and reads its ResponseCode/Description. `'0'` = accepted. */
export function parseCdr(cdrZip: Uint8Array): CdrResult {
  const files = unzipToText(cdrZip);
  const entry = Object.entries(files).find(([name]) => /^R-.*\.xml$/i.test(name));
  if (!entry) {
    throw new Error(`SUNAT CDR zip has no R-*.xml entry (found: ${Object.keys(files).join(', ') || 'none'})`);
  }
  const [, xml] = entry;
  const responseCode = extractTag(xml, 'ResponseCode') ?? '';
  const description = extractTag(xml, 'Description') ?? '';
  const notes = extractAllTags(xml, 'Note');
  return { responseCode, description, notes };
}
