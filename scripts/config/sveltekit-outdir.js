/**
 * Keep SvelteKit's generated client graph isolated whenever Vite uses an
 * isolated dependency cache. Concurrent dev/audit servers that share one
 * `.svelte-kit` directory can otherwise import two Svelte runtime instances.
 */
export function svelteKitOutDir(viteCacheDir) {
  if (!viteCacheDir) return '.svelte-kit';

  const cacheName = viteCacheDir.replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
  if (!cacheName || cacheName === '.vite') return '.svelte-kit';

  const suffix = cacheName.replace(/^\.vite-?/, '').replace(/[^a-zA-Z0-9_-]+/g, '-');

  return `.svelte-kit-${suffix || 'isolated'}`;
}
