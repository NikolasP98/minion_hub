import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglide } from '@inlang/paraglide-sveltekit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

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
  // Allow Tailscale `.ts.net` hostnames only when explicitly opted in
  // (VITE_TS_DEV=1) — a no-op for normal localhost dev servers.
  server: process.env.VITE_TS_DEV ? { allowedHosts: ['.ts.net'] } : {},
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    paraglide({ project: './project.inlang', outdir: './src/lib/paraglide' }),
    tailwindcss(),
    sveltekit(),
  ],
  optimizeDeps: {
    include: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/slider', '@inlang/paraglide-sveltekit/internal'],
    exclude: ['@dimforge/rapier2d-compat'],
  },
  ssr: {
    noExternal: [
      '@zag-js/popover',
      '@zag-js/combobox',
      '@zag-js/slider',
      '@zag-js/svelte',
      '@minion-stack/ui',
    ],
  },
});
