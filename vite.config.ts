import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    include: ['@zag-js/popover', '@zag-js/select'],
  },
  ssr: {
    noExternal: ['@zag-js/popover', '@zag-js/select', '@zag-js/svelte'],
  },
});
