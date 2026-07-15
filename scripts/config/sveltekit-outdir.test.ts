import { describe, expect, it } from 'vitest';
import { svelteKitOutDir } from './sveltekit-outdir.js';

describe('svelteKitOutDir', () => {
  it('keeps the normal dev server on the default generated directory', () => {
    expect(svelteKitOutDir(undefined)).toBe('.svelte-kit');
    expect(svelteKitOutDir('node_modules/.vite')).toBe('.svelte-kit');
  });

  it('isolates generated modules alongside an isolated Vite cache', () => {
    expect(svelteKitOutDir('node_modules/.vite-capture')).toBe('.svelte-kit-capture');
    expect(svelteKitOutDir('node_modules/.vite-audit-2')).toBe('.svelte-kit-audit-2');
  });
});
