import { env } from '$env/dynamic/private';

/**
 * SUNAT registry lookup via PERUDEVS (`GET /api/v1/ruc?document=&key=`,
 * RUC 10 and 20). Owner rule 2026-09-17: EVERY RUC/business party must be
 * verified against this registry — the create path (`POST /api/crm/parties`)
 * calls it server-side, so no client can register an unverified company.
 *
 * TODO(handoff): the DNI twin lives in @minion-stack/crm-sdk (lookupDni); this
 * should move there when the vendored SDK is next rebuilt.
 * TODO(handoff): RUC parties created BEFORE 2026-09-17 are unverified (no
 * metadata.ruc_registry); a backfill needs the dni-validation tick extended to
 * 11-digit company docs AND scheduled (it is still unwired) — see meta proposal
 * 2026-09-13-pos-packages-plans-s1-followups §34.1.
 */
const PERUDEVS_RUC_URL = 'https://api.perudevs.com/api/v1/ruc';

export interface RucCompany {
  ruc: string;
  legalName: string;
  tradeName: string | null;
  companyType: string | null;
  address: string | null;
  active: boolean;
}

export type RucLookupResult =
  | { status: 'found'; company: RucCompany }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

interface PerudevsRucResponse {
  estado?: boolean;
  mensaje?: string;
  resultado?: {
    id?: string;
    razon_social?: string;
    nombre_comercial?: string;
    tipo?: string;
    estado?: string;
    direccion?: string;
  };
}

// ponytail: per-instance TTL cache so the form's preview lookup and the create
// verification (seconds apart) cost one metered API call, not two.
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; result: RucLookupResult }>();

export function parseRucResponse(status: number, body: unknown): RucLookupResult {
  const payload = (body ?? {}) as PerudevsRucResponse;
  const r = payload.resultado;
  if (payload.estado && r?.razon_social) {
    return {
      status: 'found',
      company: {
        ruc: r.id ?? '',
        legalName: r.razon_social,
        tradeName: r.nombre_comercial && r.nombre_comercial !== '-' ? r.nombre_comercial : null,
        companyType: r.tipo ?? null,
        address: r.direccion && r.direccion !== '-' ? r.direccion : null,
        active: r.estado === 'ACTIVO',
      },
    };
  }
  // The registry answers 200 `{estado:false, mensaje:"No se ha encontrado…"}`
  // for an unknown RUC (probed 2026-09-17); 404/422 are kept for parity with
  // the SDK's DNI parser.
  if (status === 200 || status === 404 || status === 422) return { status: 'not_found' };
  return { status: 'error', message: payload.mensaje ?? `http ${status}` };
}

export async function lookupRuc(ruc: string, apiKey: string): Promise<RucLookupResult> {
  if (!/^\d{11}$/.test(ruc)) return { status: 'error', message: 'RUC must be exactly 11 digits' };
  const hit = cache.get(ruc);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;
  const url = new URL(PERUDEVS_RUC_URL);
  url.searchParams.set('document', ruc);
  url.searchParams.set('key', apiKey);
  let result: RucLookupResult;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 429) return { status: 'error', message: 'rate limited (429)' };
    result = parseRucResponse(res.status, await res.json().catch(() => null));
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
  if (result.status !== 'error') cache.set(ruc, { at: Date.now(), result });
  return result;
}

/** `lookupRuc` with the configured key; `configured:false` when there is none. */
export async function lookupRucConfigured(
  ruc: string,
): Promise<RucLookupResult | { status: 'unconfigured' }> {
  const apiKey = env.PERUDEVS_API_KEY;
  if (!apiKey) return { status: 'unconfigured' };
  return lookupRuc(ruc, apiKey);
}
