import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { paraglide } from '@inlang/paraglide-sveltekit/vite';
import { defineConfig } from 'vite';

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
