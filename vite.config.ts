import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  optimizeDeps: {
    include: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/slider'],
    exclude: ['@dimforge/rapier2d-compat'],
  },
  ssr: {
    noExternal: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/slider', '@zag-js/svelte'],
  },
});
