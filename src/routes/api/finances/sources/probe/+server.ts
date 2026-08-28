import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { decryptCreds } from '$server/services/finance-secrets';
import { getSource, setSourceProbe } from '$server/services/finance.service';
import {
  classifySunatProbeError,
  probeSunatCredentials,
} from '$server/finance/connectors/sunat-source';

const probeSchema = z.object({ provider: z.literal('sunat-sire') });

export const POST: RequestHandler = async ({ locals, request }) => {
  await requireOrgCapability(locals, 'finance', 'edit');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { provider } = await parseBody(request, probeSchema);
  const source = await getSource(ctx, provider);
  if (!source?.enabled) throw error(409, 'Enable and save the SUNAT source before probing.');

  const refs = source.secretRefs as { ciphertext?: unknown; iv?: unknown };
  if (typeof refs.ciphertext !== 'string' || typeof refs.iv !== 'string') {
    throw error(409, 'Save the SUNAT credentials before probing.');
  }

  try {
    const result = await probeSunatCredentials(
      source.config,
      decryptCreds(refs.ciphertext, refs.iv),
    );
    const message = 'Credentials validated live with SUNAT.';
    await setSourceProbe(ctx, provider, { status: result.status, message });
    return json({ ok: true, message, ...result });
  } catch (cause) {
    const failure = classifySunatProbeError(cause);
    await setSourceProbe(ctx, provider, failure);
    return json({ ok: false, ...failure });
  }
};
