import { getOpenRouterModel } from '$server/llm';
import { describe, expect, it } from 'vitest';
import { runWithEffectiveAuthority } from './effective-authority';
import { buildCapabilities } from '$server/services/rbac.service';
import { issueGatewayJwt } from '$server/services/gateway-jwt.service';
import { resolveCredentialsForUser, openQualifiedGateway } from '$lib/server/gateway-rpc';
import { resolveAssistantPrincipal } from './assistant-principal';
import { workforceClientForOrg, workforceServerClient } from '$lib/server/workforce-fetch';
import { enqueueJob } from '$server/services/bg-runtime';
import { createJobRequest } from '$server/services/job-effects.service';
import { enqueueJob as enqueueFinance } from '$server/services/finance-sync-jobs.service';
import { addDocument, reingestDocument } from '$server/services/brains.service';
const scope = {
  profileId: 'actor',
  orgId: 'org',
  roleKey: 'admin',
  rank: 80,
  generation: 'generation',
  invalid: false,
  capabilities: buildCapabilities(['admin'], []),
};
describe('unsupported new simulation delegation', () => {
  it('blocks real credential, assistant, workforce and enqueue entry points before any transport or mutation', async () => {
    await runWithEffectiveAuthority(scope, async () => {
      const ctx = { tenantId: 'org' } as never;
      expect(() => getOpenRouterModel('must-not-call-provider')).toThrow();
      await expect(issueGatewayJwt(ctx, 'actor')).rejects.toMatchObject({ status: 403 });
      await expect(resolveCredentialsForUser('actor', 'org')).rejects.toMatchObject({
        status: 403,
      });
      expect(() =>
        openQualifiedGateway({ url: 'ws://must-not-connect.invalid', token: 'synthetic' }, {
          version: 'x',
          commit: 'x',
        } as never),
      ).toThrow();
      await expect(
        resolveAssistantPrincipal({} as never, new URL('https://fixture.invalid')),
      ).rejects.toMatchObject({ status: 403 });
      expect(() => workforceServerClient({} as never)).toThrow();
      await expect(workforceClientForOrg('org')).rejects.toMatchObject({ status: 403 });
      await expect(enqueueJob({ tenantId: 'org', type: 'synthetic' })).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        createJobRequest(ctx, {} as never, '', {} as never, async () => undefined),
      ).rejects.toMatchObject({ status: 403 });
      await expect(enqueueFinance(ctx, 'synthetic')).rejects.toMatchObject({ status: 403 });
      await expect(
        addDocument(ctx, 'brain', {} as never, {} as never, {} as never),
      ).rejects.toMatchObject({ status: 403 });
      await expect(reingestDocument(ctx, 'brain', 'doc', {} as never)).rejects.toMatchObject({
        status: 403,
      });
    });
  });
});
