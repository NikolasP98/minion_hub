import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'Minion Hub',
    identifier: 'app.minionhub.desktop',
    version: '0.0.1',
  },
  runtime: {
    exitOnLastWindowClosed: true, // D-02: quit when last window closes, no tray
  },
  build: {
    bun: {
      entrypoint: 'desktop/main.ts',
    },
    copy: {
      // Copy the SvelteKit adapter-node build output into the app bundle
      // so desktop/main.ts can import handler.js at runtime
      'build/client': 'build/client',
      'build/server': 'build/server',
      'build/handler.js': 'build/handler.js',
      'build/env.js': 'build/env.js',
      'build/index.js': 'build/index.js',
      'build/shims.js': 'build/shims.js',
    },
  },
} satisfies ElectrobunConfig;
