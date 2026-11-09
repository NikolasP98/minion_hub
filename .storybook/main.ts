import type { StorybookConfig } from '@storybook/sveltekit';
import { fileURLToPath } from 'node:url';

const envShim = fileURLToPath(new URL('./env-shim.ts', import.meta.url));

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|ts|svelte)'],
  addons: [
    '@storybook/addon-svelte-csf',
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-themes',
    '@storybook/addon-designs',
  ],
  framework: '@storybook/sveltekit',
  staticDirs: ['../static'],
  async viteFinal(config) {
    config.envPrefix = ['VITE_', 'PUBLIC_'];
    config.resolve ??= {};
    const existing = config.resolve.alias ?? [];
    config.resolve.alias = [
      ...(Array.isArray(existing)
        ? existing
        : Object.entries(existing).map(([find, replacement]) => ({ find, replacement }))),
      { find: '$env/dynamic/public', replacement: envShim },
      { find: '$env/static/public', replacement: envShim },
    ];
    return config;
  },
};
export default config;
