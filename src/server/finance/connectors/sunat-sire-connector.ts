import { registerConnector, type FinanceConnector, type CanonicalInvoice, type PullPage } from '../connector';
import { SunatSireClient } from './sunat-sire-client';
import { mapSireRegistro } from './sunat-sire-mapper';

const PER_PAGE = 100;
/** count() probes one request per period — beyond this many, skip the baseline rather than hammer SUNAT. */
const MAX_COUNT_PROBES = 25;

function makeClient(config: Record<string, unknown>, secrets: Record<string, string>) {
  const ruc = String(config.ruc ?? '');
  const clientId = String(config.clientId ?? '');
  const { username, password, clientSecret } = secrets;
  if (!/^\d{11}$/.test(ruc) || !clientId || !username || !password || !clientSecret) {
    throw new Error('sunat-sire connector requires config.ruc (11 digits), config.clientId, secrets.username, secrets.password, secrets.clientSecret');
  }
  return new SunatSireClient({ ruc, username, password, clientId, clientSecret });
}

const periodOf = (iso: string): string => iso.slice(0, 7).replace('-', '');

/**
 * Which periods to pull this run. SIRE data is period-scoped and a period keeps
 * changing until the accountant presents it — so instead of trusting the time
 * watermark alone, always re-pull from the earliest NON-presented period. Once
 * presented, a period's registro is locked and safe to leave behind.
 *
 * First run (no `since`): start from `config.startPeriod` (YYYYMM) when set —
 * that's the backfill knob — otherwise from the earliest open period.
 */
export function resolvePeriods(
  all: Array<{ perTributario: string; codEstado: string; desEstado: string }>,
  opts: { since?: string; startPeriod?: string },
): string[] {
  if (all.length === 0) return [];
  const newest = all.reduce((a, b) => (b.perTributario > a.perTributario ? b : a)).perTributario;
  const open = all.filter((p) => /^no/i.test(p.desEstado));
  const earliestOpen = open.length ? open.reduce((a, b) => (b.perTributario < a.perTributario ? b : a)).perTributario : newest;
  let start: string;
  if (opts.since) start = periodOf(opts.since) < earliestOpen ? periodOf(opts.since) : earliestOpen;
  else start = opts.startPeriod ?? earliestOpen;
  return all
    .map((p) => p.perTributario)
    .filter((p) => p >= start && p <= newest)
    .sort();
}

export const sunatSireConnector: FinanceConnector = {
  provider: 'sunat-sire',
  async *pullPages({ config, secrets, since, cursor }): AsyncIterable<PullPage> {
    const client = makeClient(config, secrets);
    const periods = resolvePeriods(await client.periodos(), {
      since,
      startPeriod: typeof config.startPeriod === 'string' ? config.startPeriod : undefined,
    });
    // Cursor "PERIODO|PAGE" — resume mid-period after an interrupted run.
    const [curPeriod, curPage] = (cursor ?? '').split('|');
    for (let pi = 0; pi < periods.length; pi++) {
      const periodo = periods[pi];
      if (curPeriod && periodo < curPeriod) continue;
      let page = curPeriod === periodo ? Math.max(1, Number(curPage) || 1) : 1;
      for (;;) {
        const body = await client.propuestaPage(periodo, page, PER_PAGE);
        const total = body.paginacion?.totalRegistros ?? 0;
        const hasMore = page * PER_PAGE < total;
        const next = hasMore ? `${periodo}|${page + 1}` : pi + 1 < periods.length ? `${periods[pi + 1]}|1` : null;
        yield { invoices: body.registros.map(mapSireRegistro), cursor: next };
        if (!hasMore) break;
        page++;
      }
    }
  },
  async *pull(opts): AsyncIterable<CanonicalInvoice> {
    for await (const page of sunatSireConnector.pullPages(opts)) yield* page.invoices;
  },
  /** Sum of documents across the resolved periods. Doubles as the credential probe on save. */
  async count({ config, secrets, since }): Promise<number | null> {
    const client = makeClient(config, secrets);
    const periods = resolvePeriods(await client.periodos(), {
      since,
      startPeriod: typeof config.startPeriod === 'string' ? config.startPeriod : undefined,
    });
    if (periods.length === 0 || periods.length > MAX_COUNT_PROBES) {
      // Still authenticate so a bad credential fails loudly here.
      if (periods.length === 0) await client.login();
      return null;
    }
    let sum = 0;
    for (const p of periods) sum += (await client.count(p)) ?? 0;
    return sum;
  },
};

registerConnector(sunatSireConnector);
