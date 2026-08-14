const TOKEN_BASE = 'https://api-seguridad.sunat.gob.pe';
const API_BASE = 'https://api-sire.sunat.gob.pe';
const SCOPE = API_BASE;

/** Per-request timeout — a hung SUNAT response aborts instead of parking the worker forever. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Backoff schedule for retryable failures (timeout / 429 / 5xx). */
const RETRY_BACKOFF_MS = [1_000, 4_000, 12_000];
/** Gentle pacing between page fetches — SUNAT's API gateway rate-limits aggressively. */
const PAGE_DELAY_MS = 300;
/** Refresh the OAuth token this long before its stated expiry (tokens last ~3600s). */
const TOKEN_SLACK_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SirePage {
  paginacion: { page: number; perPage: number; totalRegistros: number };
  registros: Record<string, unknown>[];
  totales?: Record<string, unknown>;
}

/** One row of consultaestadotickets — the async export-ticket poll response. */
export interface TicketStatus {
  desEstadoProceso?: string;
  archivoReporte?: Array<{ codTipoAchivoReporte: string; nomArchivoReporte: string }>;
}

export interface SireCreds {
  /** RUC of the taxpayer (11 digits). */
  ruc: string;
  /** SOL secondary user + clave (NOT the principal). */
  username: string;
  password: string;
  /** App registered in SOL → "Gestión Credenciales de API SUNAT". */
  clientId: string;
  clientSecret: string;
}

export class SunatSireClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private creds: SireCreds) {}

  /** fetch + AbortController timeout. Throws on timeout (AbortError) or network error. */
  private async fetchOnce(url: string, init?: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * fetch with timeout + retry/backoff. Retries on a network/timeout error or a
   * retryable status (429, 5xx); other 4xx are returned to the caller. After the
   * backoff schedule is exhausted the last error/response surfaces so advanceJob
   * fails the page with the cursor preserved (resume retries it).
   */
  private async fetchRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
      try {
        const res = await this.fetchOnce(url, init);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`sunat ${res.status}`);
          if (attempt < RETRY_BACKOFF_MS.length) { await sleep(RETRY_BACKOFF_MS[attempt]); continue; }
          return res; // exhausted — let the caller treat as a failure
        }
        return res;
      } catch (e) {
        lastErr = e; // timeout (AbortError) or network failure
        if (attempt < RETRY_BACKOFF_MS.length) { await sleep(RETRY_BACKOFF_MS[attempt]); continue; }
        throw lastErr instanceof Error ? lastErr : new Error('sunat request failed');
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('sunat request failed');
  }

  /**
   * OAuth password grant against api-seguridad. Username is RUC+SOL user
   * concatenated (e.g. "20611172967NIKO1998") — SUNAT's convention, not ours.
   */
  async login(): Promise<void> {
    const { ruc, username, password, clientId, clientSecret } = this.creds;
    const body = new URLSearchParams({
      grant_type: 'password',
      scope: SCOPE,
      client_id: clientId,
      client_secret: clientSecret,
      username: `${ruc}${username}`,
      password,
    });
    const res = await this.fetchRetry(`${TOKEN_BASE}/v1/clientessol/${encodeURIComponent(clientId)}/oauth2/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      // Carry SUNAT's reason (error_description), not just the status — the body
      // never echoes the submitted secret, so it is safe to surface.
      const detail = await res.text().catch(() => '');
      throw new Error(`sunat token failed: ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`);
    }
    const tok = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = tok.access_token;
    this.tokenExpiresAt = Date.now() + (tok.expires_in ?? 3600) * 1000 - TOKEN_SLACK_MS;
  }

  private async authedGet(url: string): Promise<Response> {
    if (!this.token || Date.now() >= this.tokenExpiresAt) await this.login();
    let res = await this.fetchRetry(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (res.status === 401) {
      await this.login();
      res = await this.fetchRetry(url, { headers: { Authorization: `Bearer ${this.token}` } });
    }
    return res;
  }

  /**
   * All periods SUNAT knows for this RUC, newest first, flattened across
   * ejercicios. `codEstado`/`desEstado` distinguish presented ('Presentado')
   * from still-open ('No Presentado') periods. `codLibro` selects the book:
   * 140000 = RVIE (ventas), 080000 = RCE (compras) — same response shape.
   */
  async periodos(
    codLibro: '140000' | '080000' = '140000',
  ): Promise<Array<{ perTributario: string; codEstado: string; desEstado: string }>> {
    const res = await this.authedGet(`${API_BASE}/v1/contribuyente/migeigv/libros/rvierce/padron/web/omisos/${codLibro}/periodos`);
    if (!res.ok) throw new Error(`sunat periodos fetch failed: ${res.status}`);
    const body = (await res.json()) as Array<{ lisPeriodos?: Array<{ perTributario: string; codEstado: string; desEstado: string }> }>;
    return (Array.isArray(body) ? body : []).flatMap((e) => e.lisPeriodos ?? []);
  }

  /** RCE periods — codLibro 080000. Convenience wrapper over periodos(). */
  async periodosRce(): Promise<Array<{ perTributario: string; codEstado: string; desEstado: string }>> {
    return this.periodos('080000');
  }

  /**
   * Synchronous CSV resumen (per-doc-type aggregates) for one RCE period.
   * tipoResumen: 1=propuesta, 4=registro. tipoArchivo: 0=… (SUNAT's own enum,
   * undocumented beyond "0 works"). This is the row-level fallback source
   * (see the sunat-rce-client quirk note in the purchases spec §1) — SUNAT
   * has no paged-JSON comprobantes endpoint for RCE, only this aggregate CSV
   * and the broken async file export below.
   */
  async resumenComprobantes(periodo: string, tipoResumen = '1', tipoArchivo = '0'): Promise<string> {
    const res = await this.authedGet(
      `${API_BASE}/v1/contribuyente/migeigv/libros/rvierce/resumen/web/resumencomprobantes/${periodo}/${tipoResumen}/${tipoArchivo}/exporta?codLibro=080000`,
    );
    if (!res.ok) throw new Error(`sunat resumen fetch failed (${periodo}): ${res.status}`);
    return res.text();
  }

  /** Kicks off the async RCE propuesta row-level export; returns the ticket id. */
  async exportarPropuestaRce(periodo: string): Promise<string> {
    const res = await this.authedGet(
      `${API_BASE}/v1/contribuyente/migeigv/libros/rce/propuesta/web/propuesta/${periodo}/exportacioncomprobantepropuesta?codTipoArchivo=0&codOrigenEnvio=2`,
    );
    if (!res.ok) throw new Error(`sunat rce export ticket failed (${periodo}): ${res.status}`);
    const body = (await res.json()) as { numTicket: string };
    return body.numTicket;
  }

  /** Polls the status of an export ticket; `archivoReporte[].nomArchivoReporte`
   *  is the generated file name once `desEstadoProceso` is 'Terminado'. */
  async consultaEstadoTicket(perIni: string, perFin: string, numTicket: string): Promise<TicketStatus | null> {
    const u = new URL(`${API_BASE}/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/consultaestadotickets`);
    u.searchParams.set('perIni', perIni);
    u.searchParams.set('perFin', perFin);
    u.searchParams.set('page', '1');
    u.searchParams.set('perPage', '20');
    u.searchParams.set('numTicket', numTicket);
    const res = await this.authedGet(u.toString());
    if (!res.ok) throw new Error(`sunat ticket status failed (${numTicket}): ${res.status}`);
    const body = (await res.json()) as { registros?: TicketStatus[] };
    return body.registros?.[0] ?? null;
  }

  /**
   * ⚠️ Verified broken on SUNAT's own API gateway (2026-08-14): every request
   * shape tried (default UA, browser UA + HTTP/1.1, codTipoArchivoReporte
   * '00'/'01'/omitted, +numTicket/perIni/perFin, the misspelled
   * `codTipoAchivoReporte` key, both the .zip and inner .txt file names)
   * returns the SAME HTTP 500 whose body names an internal path with a stray
   * `/e/` segment (`.../rvierce/gestionprocesosmasivos/web/e/masivo/archivoreporte`)
   * that appears in NO documented endpoint — a server-side routing bug, not a
   * client header/param issue. Kept for when SUNAT fixes it; purchases.service
   * does not call this — it uses resumenComprobantes() instead (see spec §1).
   */
  async descargarArchivoReporte(nomArchivoReporte: string, codTipoArchivoReporte = '00'): Promise<Response> {
    const u = new URL(`${API_BASE}/v1/contribuyente/migeigv/libros/rvierce/gestionprocesosmasivos/web/masivo/archivoreporte`);
    u.searchParams.set('nomArchivoReporte', nomArchivoReporte);
    u.searchParams.set('codTipoArchivoReporte', codTipoArchivoReporte);
    return this.authedGet(u.toString());
  }

  /**
   * One page of the RVIE propuesta for a period (YYYYMM). Works for both the
   * open period and already-presented ones (verified empirically 2026-08-14),
   * which is what makes month-by-month backfill possible.
   */
  async propuestaPage(periodo: string, page: number, perPage = 100): Promise<SirePage> {
    const u = new URL(`${API_BASE}/v1/contribuyente/migeigv/libros/rvie/propuesta/web/propuesta/${periodo}/comprobantes`);
    u.searchParams.set('page', String(page));
    u.searchParams.set('perPage', String(perPage));
    u.searchParams.set('mostrarDetalle', '1');
    if (page > 1) await sleep(PAGE_DELAY_MS); // pace requests to avoid rate-limiting
    const res = await this.authedGet(u.toString());
    if (!res.ok) throw new Error(`sunat propuesta fetch failed (${periodo} p${page}): ${res.status}`);
    const body = (await res.json()) as SirePage;
    return { paginacion: body.paginacion, registros: body.registros ?? [], totales: body.totales };
  }

  /** Document count for one period via a perPage=1 probe. Doubles as the credential check. */
  async count(periodo: string): Promise<number | null> {
    const body = await this.propuestaPage(periodo, 1, 1);
    const n = body.paginacion?.totalRegistros;
    return typeof n === 'number' ? n : null;
  }
}
