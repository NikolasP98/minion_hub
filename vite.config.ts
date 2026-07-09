import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglide } from '@inlang/paraglide-sveltekit/vite';
import { defineConfig, type Plugin } from 'vite';
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
  server: {
    // Don't watch build output. `.vercel/` (adapter-vercel output, gitignored)
    // is left behind by `build` and its `*.func` symlinks point at a malformed
    // target — the dev watcher walking it leaks ~40MB/s and OOMs the dev server.
    watch: { ignored: ['**/.vercel/**'] },
    ...(process.env.VITE_TS_DEV ? { allowedHosts: ['.ts.net'] } : {}),
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    // vite-plugin-svelte 7 removed the `plugin.api.sveltePreprocess` auto-collection
    // hook, so paraglide's `register-preprocessor` plugin is now dead weight in the
    // vite pipeline and only emits a (now-stale) "preprocessor not added" warning.
    // Drop it here; the preprocessor is registered manually in svelte.config.js.
    (paraglide({ project: './project.inlang', outdir: './src/lib/paraglide' }) as Plugin[]).filter(
      (p) => p.name !== '@inlang/paraglide-sveltekit/vite/register-preprocessor',
    ),
    tailwindcss(),
    sveltekit(),
  ],
  resolve: {
    // bun installs nested duplicate copies of the prosemirror packages (same
    // version, separate instances), which breaks ProseMirror's instanceof
    // identity checks — splitBlock/Enter throw "Can not convert <> to a
    // Fragment (multiple versions of prosemirror-model)" in the note editor.
    // Force a single module instance for every prosemirror package.
    dedupe: [
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-transform',
      'prosemirror-view',
      'prosemirror-commands',
      'prosemirror-keymap',
      'prosemirror-schema-list',
      'prosemirror-inputrules',
      'prosemirror-gapcursor',
      'prosemirror-dropcursor',
      'prosemirror-history',
      'prosemirror-markdown',
      'prosemirror-tables',
      'prosemirror-changeset',
    ],
  },
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
