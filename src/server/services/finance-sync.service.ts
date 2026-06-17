import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getConnector } from '$server/finance/connector';
import '$server/finance/connectors/susii-connector'; // self-registers the 'susii' connector
import { getSource, upsertInvoice, setSourceSync } from './finance.service';
import { overlapSince, nowIso } from './finance-sync.helpers';

/** Resolve a source's secret-name map to actual values from server env. */
function resolveSecrets(refs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, name] of Object.entries(refs)) {
    const v = (env as Record<string, string | undefined>)[name];
    if (v) out[k] = v;
  }
  return out;
}

export async function syncSource(ctx: CoreCtx, provider: string) {
  const source = await getSource(ctx, provider);
  if (!source) throw new Error(`no source configured for provider ${provider}`);
  if (!source.enabled) return { provider, count: 0, status: 'success' as const };
  const connector = getConnector(provider);
  if (!connector) throw new Error(`no connector registered for provider ${provider}`);

  const startedAt = nowIso();
  const secrets = resolveSecrets((source.secretRefs ?? {}) as Record<string, string>);
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
