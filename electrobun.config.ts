import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'Minion Hub',
    identifier: 'app.minionhub.desktop',
    version: '0.0.1',
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: 'desktop/main.ts',
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      chromiumFlags: {
        'no-sandbox': true,
      },
    },
  },
  scripts: {
    postBuild: './desktop/postbuild.sh',
  },
} satisfies ElectrobunConfig;
