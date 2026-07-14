import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCREEN_DESIGN_MANIFEST } from './route-design-manifest';

const WAVE_E_SCREENS = {
  '/auth/reset': 'src/routes/auth/reset/+page.svelte',
  '/book/[slug]': 'src/routes/book/[slug]/+page.svelte',
  '/invite/accept': 'src/routes/invite/accept/+page.svelte',
  '/join': 'src/routes/join/+page.svelte',
  '/join/sent': 'src/routes/join/sent/+page.svelte',
  '/link/[code]': 'src/routes/link/[code]/+page.svelte',
  '/login': 'src/routes/login/+page.svelte',
  '/login/forgot': 'src/routes/login/forgot/+page.svelte',
  '/onboarding': 'src/routes/onboarding/+page.svelte',
  '/onboarding/complete': 'src/routes/onboarding/complete/+page.svelte',
} as const;

describe('Wave E public and auth composition', () => {
  it('enumerates the complete executable Wave E route contract', () => {
    const manifestRoutes = SCREEN_DESIGN_MANIFEST.filter((route) => route.migrationWave === 'E');

    expect(manifestRoutes.map((route) => route.pattern).sort()).toEqual(
      Object.keys(WAVE_E_SCREENS).sort(),
    );
    expect(manifestRoutes).toHaveLength(10);
    expect(manifestRoutes.every((route) => route.archetype === 'public-auth')).toBe(true);
  });

  it.each(Object.entries(WAVE_E_SCREENS))(
    '%s composes the shared public task shell',
    (_pattern, relativePath) => {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
      expect(source).toContain("from '$lib/components/ui/foundations'");
      expect(source).toContain('<PublicTaskShell');
    },
  );

  it('uses the same public task shell for global route failures', () => {
    const source = readFileSync(join(process.cwd(), 'src/routes/+error.svelte'), 'utf8');
    expect(source).toContain('<PublicTaskShell');
  });

  it('keeps channel-link login returns aligned with the login query contract', () => {
    const loginSource = readFileSync(join(process.cwd(), 'src/routes/login/+page.svelte'), 'utf8');
    const linkServerSource = readFileSync(
      join(process.cwd(), 'src/routes/link/[code]/+page.server.ts'),
      'utf8',
    );

    expect(loginSource).toContain("searchParams.get('redirectTo')");
    expect(linkServerSource).toContain('/login?redirectTo=');
    expect(linkServerSource).not.toContain('/login?redirect=');
  });

  it('keeps anonymous public pages out of the root client auth redirect', () => {
    const rootLayoutSource = readFileSync(join(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

    expect(rootLayoutSource).toContain("current.startsWith('/book/')");
    expect(rootLayoutSource).toContain("current === '/invite/accept'");
  });
});
