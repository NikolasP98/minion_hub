import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production client boundary build wiring', () => {
  it('runs the real-output scan and mutation canary after the SvelteKit build', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['test:client-build-boundary']).toBe(
      'node scripts/qc/assert-client-build-boundary.mjs',
    );
    expect(packageJson.scripts['test:client-build-boundary-canary']).toBe(
      'node scripts/qc/assert-client-build-boundary-canary.mjs',
    );
    expect(packageJson.scripts.build).toMatch(
      /vite build && bun run test:client-build-boundary && bun run test:client-build-boundary-canary$/,
    );

    const viteConfig = readFileSync('vite.config.ts', 'utf8');
    expect(viteConfig).toContain(
      "import { clientBuildBoundaryPlugin } from './scripts/qc/client-build-boundary-plugin.mjs';",
    );
    expect(viteConfig).toMatch(/plugins:\s*\[\s*clientBuildBoundaryPlugin\(\),/);
  });

  it('keeps the required production build on the CI check-and-build path', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toMatch(/- name: Build\s+run: bun run build(?:\s|$)/);
  });
});
