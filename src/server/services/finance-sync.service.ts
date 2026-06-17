import type { CoreCtx } from '$server/auth/core-ctx';
import { getConnector } from '$server/finance/connector';
import '$server/finance/connectors/susii-connector'; // self-registers the 'susii' connector
import { getSource, upsertInvoice, setSourceSync } from './finance.service';
import { decryptCreds } from './finance-secrets';
import { overlapSince, nowIso } from './finance-sync.helpers';

export async function syncSource(ctx: CoreCtx, provider: string) {
  const source = await getSource(ctx, provider);
  if (!source) throw new Error(`no source configured for provider ${provider}`);
  if (!source.enabled) return { provider, count: 0, status: 'success' as const };
  const connector = getConnector(provider);
  if (!connector) throw new Error(`no connector registered for provider ${provider}`);

  const refs = (source.secretRefs ?? {}) as Record<string, unknown>;
  if (!refs.ciphertext || !refs.iv) {
    await setSourceSync(ctx, provider, { watermark: source.watermark ?? '', status: 'failed' });
    return { provider, count: 0, status: 'failed' as const, error: 'no credentials configured' };
  }
  const { username, password } = decryptCreds(String(refs.ciphertext), String(refs.iv));
  const secrets: Record<string, string> = { username, password };

  const startedAt = nowIso();
  let count = 0;
  let consecutiveFailures = 0;
  try {
    for await (const inv of connector.pull({
      config: (source.config ?? {}) as Record<string, unknown>,
      secrets,
      since: overlapSince(source.watermark),
    })) {
      try {
        await upsertInvoice(ctx, inv);
        count++;
        consecutiveFailures = 0;
      } catch {
        if (++consecutiveFailures >= 5) throw new Error('aborted: 5 consecutive invoice failures');
      }
    }
    await setSourceSync(ctx, provider, { watermark: startedAt, status: 'success' });
    return { provider, count, status: 'success' as const };
  } catch (e) {
    await setSourceSync(ctx, provider, { watermark: source.watermark ?? '', status: 'failed' });
    return { provider, count, status: 'failed' as const, error: e instanceof Error ? e.message : 'sync failed' };
  }
}
