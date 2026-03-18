import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglide } from '@inlang/paraglide-sveltekit/vite';
import { defineConfig } from 'vite';

// @inlang/paraglide-js bundles posthog-node and creates a client at import time.
// On process exit, posthog-node's shutdown() rejects with a timeout error.
// Node 24 (Vercel build env) treats unhandled rejections as fatal (exit 1).
// This handler swallows only PostHog telemetry errors; all others still crash.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes('PostHog') || msg.includes('posthog')) return;
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

export default defineConfig({
  plugins: [
    paraglide({ project: './project.inlang', outdir: './src/lib/paraglide' }),
    tailwindcss(),
    sveltekit(),
  ],
  optimizeDeps: {
    include: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/slider'],
    exclude: ['@dimforge/rapier2d-compat'],
  },
  ssr: {
    noExternal: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/slider', '@zag-js/svelte'],
  },
});
