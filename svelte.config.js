import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// D-05: dynamic import() selects adapter based on DESKTOP env var.
// Top-level await works because package.json has "type": "module".
const adapterModule = process.env.DESKTOP === '1'
  ? await import('@sveltejs/adapter-node')
  : await import('@sveltejs/adapter-vercel');

const adapter = adapterModule.default;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: process.env.DESKTOP === '1'
      ? adapter()
      : adapter({ runtime: 'nodejs22.x' }),
    alias: {
      '$server': 'src/server',
      '$server/*': 'src/server/*'
    },
    paths: {
      relative: false
    }
  }
};

export default config;
