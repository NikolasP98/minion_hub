import { registerConnector, type FinanceConnector, type CanonicalInvoice } from '../connector';
import { SusiiClient } from './susii-client';
import { mapSusiiSale } from './susii-mapper';

export const susiiConnector: FinanceConnector = {
  provider: 'susii',
  async *pull({ config, secrets, since }): AsyncIterable<CanonicalInvoice> {
    const username = secrets.username;
    const password = secrets.password;
    const businessId = Number(config.businessId);
    if (!username || !password || !Number.isFinite(businessId)) {
      throw new Error('susii connector requires secrets.username, secrets.password, config.businessId');
    }
    const client = new SusiiClient({ username, password });
    for await (const page of client.salesPages({ businessId, since })) {
      for (const sale of page) yield mapSusiiSale(sale as Record<string, unknown>);
    }
  },
};

registerConnector(susiiConnector);
