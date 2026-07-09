import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { paraglide } from '@inlang/paraglide-sveltekit/vite';

// D-05: dynamic import() selects adapter based on DESKTOP env var.
// Top-level await works because package.json has "type": "module".
const adapterModule =
  process.env.DESKTOP === '1'
    ? await import('@sveltejs/adapter-node')
    : await import('@sveltejs/adapter-vercel');

const adapter = adapterModule.default;

// @sveltejs/vite-plugin-svelte 7 removed the `plugin.api.sveltePreprocess`
// auto-registration hook that @inlang/paraglide-sveltekit (deprecated) relies on
// to inject its link-translation preprocessor (href/action locale-prefixing).
// Pull it off the plugin's `api` and add it to `preprocess` manually so i18n link
// behavior is identical to before the vite 8 / plugin-svelte 7 bump.
const paraglidePreprocessor = paraglide({
  project: './project.inlang',
  outdir: './src/lib/paraglide',
})
  .find((p) => p.name === '@inlang/paraglide-sveltekit/vite/register-preprocessor')
  ?.api?.sveltePreprocess;

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess(), ...(paraglidePreprocessor ? [paraglidePreprocessor] : [])],
  kit: {
    adapter: process.env.DESKTOP === '1' ? adapter() : adapter({ runtime: 'nodejs22.x' }),
    alias: {
      $server: 'src/server',
      '$server/*': 'src/server/*',
    },
    paths: {
      relative: false,
    },
  },
};

export default config;
