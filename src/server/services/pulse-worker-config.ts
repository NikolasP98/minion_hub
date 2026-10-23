import { z } from 'zod';
import { pulseHash } from './pulse-action-contract';

const schema = z
  .object({
    enabled: z.boolean(),
    tenantId: z.string().uuid(),
    ownerProfileId: z.string().uuid(),
    channel: z.enum(['prd', 'dev']),
    gatewayId: z.string().uuid(),
    endpoint: z.string().url(),
    version: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    bindingContract: z.literal('cron-binding-v1'),
    evidence: z.string().min(1).max(1024),
    expiresAt: z.string().datetime(),
    revision: z.string().min(1).max(128),
  })
  .strict();
export type PulseWorkerConfig = Readonly<z.infer<typeof schema>>;
/** Deployment-managed qualification. No route accepts this configuration from its caller. */
export function readPulseWorkerScope(): PulseWorkerConfig | null {
  const raw = process.env.MINION_PULSE_WORKER_CONFIG;
  if (!raw) return null;
  try {
    if (Buffer.byteLength(raw) > 8192) return null;
    const config = schema.parse(JSON.parse(raw));
    return Object.freeze(config);
  } catch {
    return null;
  }
}
export function pulseConfigFingerprint(config: PulseWorkerConfig): string {
  return pulseHash(config);
}
export function assertPulseConfigCurrent(config: PulseWorkerConfig): void {
  const current = readPulseWorkerConfig();
  if (!current || pulseConfigFingerprint(current) !== pulseConfigFingerprint(config))
    throw new Error('Pulse qualification unavailable');
}

export function readPulseWorkerConfig(): PulseWorkerConfig | null {
  const config = readPulseWorkerScope();
  return config?.enabled && Date.parse(config.expiresAt) > Date.now() ? config : null;
}
