import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('My Agent reactive effect contracts', () => {
  it('tracks only the Chat History popover transition while sessions load', () => {
    const source = readFileSync(
      'src/lib/components/my-agent/ChatHistoryPopover.svelte',
      'utf8',
    );

    expect(source).toContain("import { untrack } from 'svelte'");
    expect(source).toContain('if (open) untrack(() => void loadSessions())');
  });
});
