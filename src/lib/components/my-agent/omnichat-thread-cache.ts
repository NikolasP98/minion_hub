export interface OmnichatThreadMessage {
  id?: string;
  clientId: string;
  direction: 'inbound' | 'outbound';
  content: string | null;
  senderName: string | null;
  occurredAt: string | null;
  pending?: boolean;
  failed?: boolean;
}

export function mergeServerThread(
  serverMessages: OmnichatThreadMessage[],
  cachedMessages: OmnichatThreadMessage[],
): OmnichatThreadMessage[] {
  const stillLocal = cachedMessages.filter(
    (cached) =>
      (cached.pending || cached.failed) &&
      !serverMessages.some((server) => server.clientId === cached.clientId),
  );
  return [...serverMessages, ...stillLocal];
}

export function settleOptimisticMessage(
  cachedMessages: OmnichatThreadMessage[],
  clientId: string,
  failed: boolean,
): OmnichatThreadMessage[] {
  return cachedMessages.map((message) =>
    message.clientId === clientId
      ? { ...message, pending: false, ...(failed ? { failed: true } : {}) }
      : message,
  );
}

export class LatestThreadRequests {
  private sequence = 0;
  private readonly latestByKey = new Map<string, number>();

  begin(key: string): number {
    const requestId = ++this.sequence;
    this.latestByKey.set(key, requestId);
    return requestId;
  }

  isLatest(key: string, requestId: number): boolean {
    return this.latestByKey.get(key) === requestId;
  }

  finish(key: string, requestId: number): boolean {
    if (!this.isLatest(key, requestId)) return false;
    this.latestByKey.delete(key);
    return true;
  }
}
