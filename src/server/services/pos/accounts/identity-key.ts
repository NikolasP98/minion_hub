import { PosError } from '../errors';

/** The persisted party/contact facets used to address one client wallet. */
export interface ClientRef {
  partyId?: string | null;
  crmContactId?: string | null;
}

export function requireClient(client: ClientRef): ClientRef {
  if (!client?.partyId && !client?.crmContactId)
    throw new PosError('partyId or crmContactId is required', 'client_required');
  return client;
}

/** Persisted party is authoritative; contact-only rows retain their legacy alias. */
export function clientKeyOf(client: ClientRef): string {
  requireClient(client);
  return client.partyId ? `party:${client.partyId}` : `contact:${client.crmContactId}`;
}

export function parseClientKey(key: string): ClientRef {
  const [kind, id] = key.split(':', 2);
  if (kind === 'contact' && id) return { crmContactId: id };
  if (kind === 'party' && id) return { partyId: id };
  throw new PosError('client key must be contact:<id> or party:<id>', 'invalid_client_key');
}
