import { describe, expect, it } from 'vitest';
import { decodeEntities, renderEmailBody } from './email-body';

describe('decodeEntities', () => {
  it('decodes named and numeric references', () => {
    expect(decodeEntities('they&#39;re gone')).toBe("they're gone");
    expect(decodeEntities('Noragami &amp; More')).toBe('Noragami & More');
    expect(decodeEntities('&lt;tag&gt; &quot;q&quot; &#x41;')).toBe('<tag> "q" A');
  });
  it('leaves unknown/malformed refs untouched', () => {
    expect(decodeEntities('a & b &bogus; &#;')).toBe('a & b &bogus; &#;');
  });
});

describe('renderEmailBody', () => {
  it('linkifies bare URLs with a safe anchor', () => {
    const html = renderEmailBody('see https://warp.dev/x?a=1&b=2 now');
    expect(html).toContain(
      '<a href="https://warp.dev/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">',
    );
    expect(html).toContain('now');
  });
  it('peels trailing punctuation off the link', () => {
    const html = renderEmailBody('(https://x.com/a).');
    expect(html).toContain('href="https://x.com/a"');
    expect(html).toContain('</a>).'); // ")." stays as text after the closed anchor
  });
  it('escapes untrusted markup — no injected tags survive', () => {
    const html = renderEmailBody('<script>alert(1)</script> & <b>x</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
  it('decodes entities before linkifying so escaped URLs still work', () => {
    // Gmail hands us `&amp;` inside the query string of a text/plain URL.
    const html = renderEmailBody('go https://x.com/a?u=1&amp;c=2 done');
    expect(html).toContain('href="https://x.com/a?u=1&amp;c=2"');
  });
});
