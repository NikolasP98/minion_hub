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
   * from still-open ('No Presentado') periods.
   */
  async periodos(): Promise<Array<{ perTributario: string; codEstado: string; desEstado: string }>> {
    const res = await this.authedGet(`${API_BASE}/v1/contribuyente/migeigv/libros/rvierce/padron/web/omisos/140000/periodos`);
    if (!res.ok) throw new Error(`sunat periodos fetch failed: ${res.status}`);
    const body = (await res.json()) as Array<{ lisPeriodos?: Array<{ perTributario: string; codEstado: string; desEstado: string }> }>;
    return (Array.isArray(body) ? body : []).flatMap((e) => e.lisPeriodos ?? []);
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
