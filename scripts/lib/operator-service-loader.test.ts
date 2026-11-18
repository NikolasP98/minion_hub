import { afterAll, describe, expect, it } from 'vitest';
import { createOperatorServiceLoader, operatorVitePlugins } from './operator-service-loader';

const principal = {
  profileId: '22222222-2222-4222-8222-222222222222',
  authProject: 'p',
  verifiedAt: 'now',
};
const target = { databaseIdentity: 'x', authProject: 'p', authUrl: 'https://a.example.org' };

describe('operator service loader', () => {
  it('refuses a principal/target mismatch before creating a server', async () => {
    await expect(
      createOperatorServiceLoader({ principal, target: { ...target, authProject: 'other' } }),
    ).rejects.toThrow(/do not match/);
  });

  it('has no inspector plugin and keeps the svelte compiler', () => {
    const names = operatorVitePlugins().map((p) => p.name);
    expect(names.some((n) => /inspector/i.test(n))).toBe(false);
    expect(names).toContain('operator-closed-virtual-modules');
    expect(names.some((n) => /svelte/.test(n))).toBe(true);
  });

  describe('real admitted graph', () => {
    let loader: Awaited<ReturnType<typeof createOperatorServiceLoader>> | undefined;
    afterAll(async () => {
      await loader?.close();
      await loader?.close(); // idempotent
    });

    it('loads real service roots with an empty env, rejects unknown keys and closes', async () => {
      loader = await createOperatorServiceLoader({ principal, target });
      const rbac = await loader.load('rbac');
      expect(typeof rbac.resolveFreshCapabilitiesReadOnlyInTransaction).toBe('function');
      const bridge = await loader.load('activeOperatorPrincipal');
      expect(typeof bridge.readOperatorAuthorityReadOnlyInTx).toBe('function');
      const audit = await loader.load('audit');
      expect(typeof audit.runAuditInventory).toBe('function');
      await expect(loader.load('nope' as never)).rejects.toThrow(/unknown registry key/);
    }, 120_000);
  });
});
