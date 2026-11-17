import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Plugin, type PluginOption, type ViteDevServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { QualifiedOperatorTarget, VerifiedOperatorPrincipal } from './operator-principal';

/**
 * Closed Vite SSR service loader (contracts/operator-bootstrap.md). Call ONLY after the CLI has admitted
 * the parameters, target and principal. Empty env, no dotenv/config/HTTP/watch; never a global fallback.
 * Foundation registry: the audit key joins in T011 together with its typeof-import (never a runtime catch).
 */
export interface OperatorServiceModules {
  rbac: typeof import('../../src/server/services/rbac.service');
  activeOperatorPrincipal: typeof import('../../src/server/auth/active-operator-principal');
  stock: typeof import('../../src/server/services/stock.service');
  pos: typeof import('../../src/server/services/pos.service');
  stockAccruals: typeof import('../../src/server/services/stock-accruals.service');
  activity: typeof import('../../src/server/services/activity.service');
  accountsList: typeof import('../../src/server/services/pos/accounts/list');
  accountsDetail: typeof import('../../src/server/services/pos/accounts/detail');
  accountsResolve: typeof import('../../src/server/services/pos/accounts/resolve');
  stockLogic: typeof import('../../src/server/services/stock.logic');
  orgCore: typeof import('../../src/server/db/with-org-core');
  pgClient: typeof import('../../src/server/db/pg-client');
  pgPool: typeof import('../../src/server/db/pg-pool');
}

export interface OperatorServiceLoader {
  load<K extends keyof OperatorServiceModules>(key: K): Promise<OperatorServiceModules[K]>;
  close(): Promise<void>;
}

const REGISTRY: Readonly<Record<keyof OperatorServiceModules, string>> = Object.freeze({
  rbac: 'src/server/services/rbac.service.ts',
  activeOperatorPrincipal: 'src/server/auth/active-operator-principal.ts',
  stock: 'src/server/services/stock.service.ts',
  pos: 'src/server/services/pos.service.ts',
  stockAccruals: 'src/server/services/stock-accruals.service.ts',
  activity: 'src/server/services/activity.service.ts',
  accountsList: 'src/server/services/pos/accounts/list.ts',
  accountsDetail: 'src/server/services/pos/accounts/detail.ts',
  accountsResolve: 'src/server/services/pos/accounts/resolve.ts',
  stockLogic: 'src/server/services/stock.logic.ts',
  orgCore: 'src/server/db/with-org-core.ts',
  pgClient: 'src/server/db/pg-client.ts',
  pgPool: 'src/server/db/pg-pool.ts',
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENV_MODULES = new Set(['$env/dynamic/private', '$env/dynamic/public']);
const APP_ENV = '$app/environment';
const VIRTUAL = '\0operator-virtual:';

/** Closed virtual modules: frozen empty env and fixed app/environment; any other $env/ or $app/ is refused. */
function virtualModules(): Plugin {
  return {
    name: 'operator-closed-virtual-modules',
    enforce: 'pre',
    resolveId(id) {
      if (ENV_MODULES.has(id) || id === APP_ENV) return VIRTUAL + id;
      if (id.startsWith('$env/') || id.startsWith('$app/')) {
        throw new Error('operator loader: virtual module is not admitted');
      }
      return null;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL)) return null;
      return id === VIRTUAL + APP_ENV
        ? "export const browser=false;export const building=false;export const dev=false;export const version='faces-operator-v1';"
        : 'export const env=Object.freeze({});';
    },
  };
}

function flatten(options: PluginOption): Plugin[] {
  if (!options) return [];
  if (Array.isArray(options)) return options.flatMap(flatten);
  return [options as Plugin];
}

/** Exported for tests: the exact, closed plugin list (inspector removed, Svelte compiler kept). */
export function operatorVitePlugins(): Plugin[] {
  const plugins = [
    virtualModules(),
    ...flatten(svelte({ configFile: false, compilerOptions: { hmr: false }, inspector: false })),
  ].filter((p) => !/inspector/i.test(p.name));
  if (!plugins.some((p) => p.name === 'vite-plugin-svelte:compile' || /svelte/.test(p.name))) {
    throw new Error('operator loader: svelte compiler plugin missing');
  }
  return plugins;
}

export async function createOperatorServiceLoader(
  input: Readonly<{ principal: VerifiedOperatorPrincipal; target: QualifiedOperatorTarget }>,
): Promise<OperatorServiceLoader> {
  const { principal, target } = input;
  if (
    !principal?.profileId ||
    !principal.verifiedAt ||
    !principal.authProject ||
    principal.authProject !== target?.authProject
  ) {
    throw new Error('operator loader: principal and target do not match');
  }
  let server: ViteDevServer | undefined;
  let closed = false;
  try {
    server = await createServer({
      root: ROOT,
      configFile: false,
      envDir: false,
      publicDir: false,
      appType: 'custom',
      logLevel: 'error',
      server: { middlewareMode: true, watch: null, hmr: false, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      ssr: { noExternal: ['lucide-svelte'] },
      resolve: {
        alias: [
          { find: /^\$server\//, replacement: `${join(ROOT, 'src', 'server')}/` },
          { find: /^\$lib\//, replacement: `${join(ROOT, 'src', 'lib')}/` },
        ],
      },
      plugins: operatorVitePlugins(),
    });
  } catch (error) {
    await server?.close();
    throw error;
  }
  const live = server;
  return {
    async load(key) {
      if (closed) throw new Error('operator loader is closed');
      if (!Object.prototype.hasOwnProperty.call(REGISTRY, key)) {
        throw new Error('operator loader: unknown registry key');
      }
      return (await live.ssrLoadModule(`/${REGISTRY[key]}`)) as OperatorServiceModules[typeof key];
    },
    async close() {
      if (closed) return;
      closed = true;
      await live.close();
    },
  };
}
