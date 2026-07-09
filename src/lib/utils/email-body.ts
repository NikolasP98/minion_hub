// Render an untrusted plain-text email body as safe HTML: decode the HTML
// entities Gmail leaves in the text/plain part (`&#39;`, `&amp;`, …), then
// linkify bare URLs. SECURITY: every character is HTML-escaped; the ONLY markup
// emitted is `<a>` with an escaped href — no other tag from the source survives,
// so this is XSS-safe even though the caller uses {@html}.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode named + numeric (decimal/hex) HTML character references to real chars. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code =
        ent[1] === 'x' || ent[1] === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      return whole;
    }
    const hit = NAMED[ent.toLowerCase()];
    return hit ?? whole;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

// Bare http(s) URL up to the next whitespace/angle bracket. Trailing sentence
// punctuation is peeled back off the match so "(https://x.com/a)." doesn't
// swallow the ")." into the link.
const URL_RE = /https?:\/\/[^\s<>]+/g;

export function renderEmailBody(raw: string): string {
  const text = decodeEntities(raw ?? '');
  let out = '';
  let last = 0;
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]}'"]+$/);
    if (trail) url = url.slice(0, url.length - trail[0].length);
    out += escapeHtml(text.slice(last, m.index));
    const safe = escapeHtml(url);
    out += `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
    // Leave any peeled trailing punctuation for the next (escaped) text slice.
    last = m.index + url.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
