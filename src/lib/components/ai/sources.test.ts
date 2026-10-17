import { describe, expect, it } from 'vitest';
import { turnSources } from './sources';
import type { ChatBlock } from '$lib/chat/blocks';

const tool = (id: string, name: string, input: unknown = {}): ChatBlock => ({
  kind: 'tool',
  id,
  name,
  input,
});

describe('turnSources', () => {
  it('reads search results JSON, keeps titles, drops non-http and duplicates', () => {
    const blocks = [tool('a', 'web_search', { query: 'x' })];
    const results = {
      a: {
        isError: false,
        content: JSON.stringify({
          results: [
            { url: 'https://www.example.com/a#top', title: 'A page', description: 'about a' },
            { url: 'https://example.com/a', title: 'dupe' },
            { url: 'javascript:alert(1)', title: 'bad' },
            { url: 'ftp://files.example.com/x', title: 'ftp' },
          ],
        }),
      },
    };
    expect(turnSources(blocks, results)).toEqual([
      {
        url: 'https://www.example.com/a',
        host: 'example.com',
        title: 'A page',
        snippet: 'about a',
      },
      { url: 'https://example.com/a', host: 'example.com', title: 'dupe', snippet: undefined },
    ]);
  });

  it('takes the fetched URL from web_fetch input, falls back to host as title', () => {
    const out = turnSources([tool('f', 'web_fetch', { url: 'https://docs.dev/page' })], {});
    expect(out).toEqual([
      { url: 'https://docs.dev/page', host: 'docs.dev', title: 'docs.dev', snippet: undefined },
    ]);
  });

  it('scans plain-text results and ignores failed calls and other tools', () => {
    const blocks = [
      tool('t', 'web_search'),
      tool('e', 'web_search'),
      tool('o', 'read', { url: 'https://nope.io' }),
    ];
    const results = {
      t: { isError: false, content: 'See https://a.io/x, and https://b.io.' },
      e: { isError: true, content: 'https://err.io' },
      o: { isError: false, content: 'https://nope.io' },
    };
    expect(turnSources(blocks, results).map((s) => s.url)).toEqual([
      'https://a.io/x',
      'https://b.io/',
    ]);
  });

  it('returns nothing for a turn without web tools', () => {
    expect(turnSources([{ kind: 'text', text: 'hi https://x.io' }], {})).toEqual([]);
  });
});
