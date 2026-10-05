import { createHash } from 'node:crypto';
import path from 'node:path';
import { assertClientBundleBoundary } from './client-bundle-boundary.mjs';

export const CLIENT_MODULE_BOUNDARY_REPORT = '.vite/client-module-boundary.json';

/**
 * @param {string} root
 * @param {unknown} moduleId
 */
function stableModuleId(root, moduleId) {
  const normalized = String(moduleId).replaceAll('\\', '/').replaceAll('\0', '').split('?')[0];
  if (!path.isAbsolute(normalized)) return normalized;

  const relative = path.relative(root, normalized).replaceAll('\\', '/');
  if (!relative.startsWith('../') && relative !== '..') return relative;

  const nodeModules = normalized.lastIndexOf('/node_modules/');
  return nodeModules >= 0
    ? normalized.slice(nodeModules + 1)
    : `<external>/${path.basename(normalized)}`;
}

/** @returns {import('vite').Plugin} */
export function clientBuildBoundaryPlugin() {
  let projectRoot = process.cwd();

  /** @type {import('vite').Plugin} */
  const plugin = {
    name: 'minion-client-build-boundary',
    apply: 'build',
    applyToEnvironment(environment) {
      return environment.name === 'client';
    },
    configResolved(config) {
      projectRoot = config.root;
    },
    generateBundle(_outputOptions, bundle) {
      if (this.environment.name !== 'client') return;

      const moduleIds = [
        ...new Set(
          Object.values(bundle).flatMap((output) =>
            output.type === 'chunk' ? Object.keys(output.modules) : [],
          ),
        ),
      ];
      if (moduleIds.length === 0) throw new Error('Vite client Rollup graph contained no modules');

      const result = assertClientBundleBoundary({
        label: 'Vite client Rollup modules',
        modules: moduleIds,
      });
      const stableModules = moduleIds.map((id) => stableModuleId(projectRoot, id)).sort();
      const graphSha256 = createHash('sha256').update(stableModules.join('\n')).digest('hex');

      this.emitFile({
        type: 'asset',
        fileName: CLIENT_MODULE_BOUNDARY_REPORT,
        source: `${JSON.stringify({
          schemaVersion: 1,
          environment: 'client',
          modules: result.modules,
          graphSha256,
          violations: result.violations,
        })}\n`,
      });
    },
  };

  return plugin;
}
