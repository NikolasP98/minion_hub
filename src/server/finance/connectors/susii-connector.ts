import { registerConnector, type FinanceConnector, type CanonicalInvoice, type PullPage } from '../connector';
import { SusiiClient } from './susii-client';
import { mapSusiiSale } from './susii-mapper';

function makeClient(config: Record<string, unknown>, secrets: Record<string, string>) {
  const username = secrets.username;
  const password = secrets.password;
  const businessId = Number(config.businessId);
  if (!username || !password || !Number.isFinite(businessId)) {
    throw new Error('susii connector requires secrets.username, secrets.password, config.businessId');
  }
  return { client: new SusiiClient({ username, password }), businessId };
}

export const susiiConnector: FinanceConnector = {
  provider: 'susii',
  async *pullPages({ config, secrets, since, cursor }): AsyncIterable<PullPage> {
    const { client, businessId } = makeClient(config, secrets);
    for await (const page of client.salesPages({ businessId, since, cursor })) {
      yield {
        invoices: page.results.map((s) => mapSusiiSale(s as Record<string, unknown>)),
        cursor: page.next,
      };
    }
  },
  async *pull(opts): AsyncIterable<CanonicalInvoice> {
    for await (const page of susiiConnector.pullPages(opts)) yield* page.invoices;
  },
  async count({ config, secrets, since }): Promise<number | null> {
    const { client, businessId } = makeClient(config, secrets);
    return client.count({ businessId, since });
  },
};

registerConnector(susiiConnector);
