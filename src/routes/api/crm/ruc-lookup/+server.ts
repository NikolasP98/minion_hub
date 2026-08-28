import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreCtx } from '$server/auth/core-ctx';

/**
 * POST /api/crm/ruc-lookup — { ruc: "20611172967" }
 * Read-only SUNAT registry lookup via perudevs, mirroring /api/crm/dni-lookup:
 * returns the fields a form would offer to fill WITHOUT writing anything.
 * POST (not GET) so the central apiWriteCapability gate covers it and the RUC
 * stays out of URLs/logs.
 *
 * TODO(handoff): the DNI twin lives in @minion-stack/crm-sdk (dniPreview);
 * this RUC fetch should move there too once the vendored SDK is next rebuilt —
 * kept hub-local for now to avoid republishing the .tgz for one function.
 */
const PERUDEVS_RUC_URL = 'https://api.perudevs.com/api/v1/ruc';

interface PerudevsRucResponse {
  estado?: boolean;
  resultado?: {
    id?: string;
    razon_social?: string;
    nombre_comercial?: string;
    tipo?: string;
    condicion?: string;
    estado?: string;
    direccion?: string;
  };
}

export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  const apiKey = env.PERUDEVS_API_KEY;
  if (!apiKey) throw error(503, 'RUC lookup not configured');

  const body = (await request.json().catch(() => null)) as { ruc?: unknown } | null;
  const ruc = typeof body?.ruc === 'string' ? body.ruc.trim() : '';
  if (!/^\d{11}$/.test(ruc)) throw error(400, 'RUC must be exactly 11 digits');

  const url = new URL(PERUDEVS_RUC_URL);
  url.searchParams.set('document', ruc);
  url.searchParams.set('key', apiKey);
  let payload: PerudevsRucResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return json({ found: false });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    payload = (await res.json()) as PerudevsRucResponse;
  } catch {
    throw error(502, 'Registry lookup failed');
  }
  const r = payload.resultado;
  if (!payload.estado || !r?.razon_social) return json({ found: false });
  return json({
    found: true,
    ruc: r.id ?? ruc,
    legalName: r.razon_social,
    tradeName: r.nombre_comercial && r.nombre_comercial !== '-' ? r.nombre_comercial : null,
    companyType: r.tipo ?? null,
    address: r.direccion ?? null,
    active: r.estado === 'ACTIVO',
  });
};
