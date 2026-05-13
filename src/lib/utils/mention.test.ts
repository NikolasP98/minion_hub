import { describe, it, expect } from 'vitest';
import { renderMention } from './mention';

describe('renderMention', () => {
  const aliases = new Map<string, string>([
    ['nikolas', 'u1'],
    ['alice', 'u2'],
  ]);

  it('wraps known aliases in mention spans', () => {
    expect(renderMention('hey @nikolas check this', aliases)).toBe(
      'hey <span class="mention" data-user-id="u1">@nikolas</span> check this',
    );
  });

  it('leaves unknown @tokens as plain text', () => {
    expect(renderMention('@unknown', aliases)).toBe('@unknown');
  });

  it('escapes HTML before wrapping', () => {
    expect(renderMention('<script>@nikolas</script>', aliases)).toBe(
      '&lt;script&gt;<span class="mention" data-user-id="u1">@nikolas</span>&lt;/script&gt;',
    );
  });

  it('handles multiple mentions and adjacent punctuation', () => {
    expect(renderMention('cc @alice, @nikolas!', aliases)).toBe(
      'cc <span class="mention" data-user-id="u2">@alice</span>, <span class="mention" data-user-id="u1">@nikolas</span>!',
    );
  });
});
