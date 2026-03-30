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
      external: [
        // D-12: native .node addons must not be bundled by Bun
        '@libsql/client',
        '@node-rs/argon2',
      ],
    },
  },
} satisfies ElectrobunConfig;
