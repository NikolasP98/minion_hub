import { describe, expect, it } from 'vitest';
import {
  canPromoteVerifiedEmptyWhatsAppSource,
  decodeConversationCursor,
  decodeWhatsAppCursor,
  encodeConversationCursor,
  encodeWhatsAppCursor,
  knowledgeContentHash,
  normalizeConversation,
  normalizeWhatsAppConversation,
  normalizeWhatsAppConversationSegments,
  preparedConversationNeedsWrite,
  qdrantOwnsKnowledgeEmbeddings,
  renderConversationRelationshipContext,
  type ConversationRelationshipContext,
  type WhatsAppMessageInput,
} from './brain-corpus.service';

const message = (
  id: string,
  content: string,
  overrides: Partial<WhatsAppMessageInput> = {},
): WhatsAppMessageInput => ({
  id,
  messageId: `wamid-${id}`,
  direction: 'inbound',
  content,
  senderId: '+51911111111',
  senderName: 'Ada',
  occurredAt: new Date(`2026-07-21T00:00:0${id}.000Z`),
  createdAt: new Date(`2026-07-21T00:01:0${id}.000Z`),
  ...overrides,
});

describe('brain corpus WhatsApp normalization', () => {
  it('produces deterministic account-scoped conversation and chunk identities', () => {
    const rows = [message('1', 'Hello'), message('2', 'Hi!', { direction: 'outbound' })];
    const first = normalizeWhatsAppConversation('+51922286663', 'customer-1', rows);
    const repeated = normalizeWhatsAppConversation(
      '+51922286663',
      'customer-1',
      [...rows].reverse(),
    );
    const relinked = normalizeWhatsAppConversation('+51900000000', 'customer-1', rows);

    expect(first.externalId).toBe('conversation:+51922286663:customer-1:2026-07');
    expect(first.rawText).toBe('Customer: Hello\nAgent: Hi!');
    expect(repeated).toEqual(first);
    expect(first.chunks[0].chunkKey).toBe('raw:000000');
    expect(first.chunks[0].contentHash).not.toBe(relinked.chunks[0].contentHash);
    expect(relinked.chunks[0].contextPrefix).toContain('+51900000000');
  });

  it('segments by stable UTC month without rekeying later months', () => {
    const july = message('1', 'July', { occurredAt: new Date('2026-07-31T23:59:59Z') });
    const august = message('2', 'August', { occurredAt: new Date('2026-08-01T00:00:00Z') });
    const initial = normalizeWhatsAppConversationSegments('account', 'chat', [july, august]);
    const inserted = normalizeWhatsAppConversationSegments('account', 'chat', [
      july,
      message('3', 'Earlier July', { occurredAt: new Date('2026-07-15T00:00:00Z') }),
      august,
    ]);
    expect(initial.map((document) => document.externalId)).toEqual([
      'conversation:account:chat:2026-07',
      'conversation:account:chat:2026-08',
    ]);
    expect(inserted[1]).toEqual(initial[1]);
    expect(inserted[0].contentHash).not.toBe(initial[0].contentHash);
  });

  it('deduplicates repeated stable channel message IDs', () => {
    const duplicate = message('2', 'duplicate history', {
      messageId: 'wamid-shared',
      occurredAt: new Date('2026-07-21T00:00:02.000Z'),
    });
    const original = message('1', 'original history', {
      messageId: 'wamid-shared',
      occurredAt: new Date('2026-07-21T00:00:01.000Z'),
    });
    const document = normalizeWhatsAppConversation('account', 'chat', [duplicate, original]);

    expect(document.rawText).toBe('Customer: original history');
    expect(document.metadata.messageCount).toBe(1);
  });

  it('preserves complete turns near the chunk budget and gives chunks stable keys', () => {
    const document = normalizeWhatsAppConversation(
      'account',
      'chat',
      [message('1', 'a'.repeat(20)), message('2', 'b'.repeat(20)), message('3', 'c'.repeat(20))],
      40,
    );

    expect(document.chunks).toHaveLength(3);
    expect(document.chunks.map((chunk) => chunk.chunkKey)).toEqual([
      'raw:000000',
      'raw:000001',
      'raw:000002',
    ]);
    expect(document.chunks.every((chunk) => chunk.chunkText.length <= 40)).toBe(true);
  });

  it('uses normalized newlines for stable content hashes', () => {
    expect(knowledgeContentHash('one\r\ntwo')).toBe(knowledgeContentHash('one\ntwo'));
  });
});

describe('brain corpus all-channel normalization', () => {
  it('includes joined CRM and business context in Instagram documents and revision hashes', () => {
    const relationshipContext = {
      contact: {
        id: 'contact-1',
        humanId: 'CRM-1',
        displayName: 'Ada Lovelace',
        lifecycleOverride: 'customer',
        source: 'instagram',
        customFields: { distrito: 'Miraflores' },
      },
      party: {
        id: 'party-1',
        type: 'person',
        name: 'Ada Lovelace',
        phone9: '911111111',
        email: 'ada@example.com',
        docType: 'DNI',
        docNumber: '12345678',
        dob: null,
        dniVerified: true,
      },
      identities: [
        {
          channel: 'instagram',
          externalId: 'ig-ada',
          handle: 'ada',
        },
      ],
      tags: ['VIP'],
      activities: [],
      finance: {
        invoiceCount: 1,
        total: 250,
        lastIssuedAt: '2026-07-20T15:00:00Z',
        recentInvoices: [],
      },
      bookings: [
        {
          status: 'confirmed',
          startTime: '2026-07-24T15:00:00Z',
          title: 'Follow-up',
          notes: null,
        },
      ],
      salesOrders: [],
      posTickets: [],
      memberships: [],
    };
    const first = normalizeConversation(
      'instagram',
      'faces',
      'ig-chat-1',
      [message('1', 'When is my appointment?')],
      relationshipContext,
    );
    const changed = normalizeConversation(
      'instagram',
      'faces',
      'ig-chat-1',
      [message('1', 'When is my appointment?')],
      {
        ...relationshipContext,
        tags: [...relationshipContext.tags, 'Returning'],
      },
    );

    expect(first.title).toContain('Instagram');
    expect(first.metadata.channel).toBe('instagram');
    expect(first.metadata.contactId).toBe('contact-1');
    expect(first.chunks[0].contextPrefix).toContain('Ada Lovelace');
    expect(first.chunks[0].contextPrefix).toContain('VIP');
    expect(first.chunks[0].contextPrefix).not.toContain('ada@example.com');
    expect(first.chunks[0].contextPrefix).not.toContain('12345678');
    expect(first.chunks[0].contextPrefix).not.toContain('Finance');
    expect(first.contentHash).not.toBe(changed.contentHash);
    expect(first.sourceRevision).not.toBe(changed.sourceRevision);
  });

  it('bounds relationship context before it is sent to either embedding owner', () => {
    const context = {
      contact: {
        id: 'contact-1',
        humanId: 'CRM-1',
        displayName: 'Ada',
        lifecycleOverride: null,
        source: 'instagram',
        customFields: {},
      },
      party: null,
      identities: [],
      tags: Array.from({ length: 1000 }, (_, index) => `${index}:${'x'.repeat(20)}`),
      activities: [],
      finance: { invoiceCount: 0, total: 0, lastIssuedAt: null, recentInvoices: [] },
      bookings: [],
      salesOrders: [],
      posTickets: [],
      memberships: [],
    } satisfies ConversationRelationshipContext;

    const rendered = renderConversationRelationshipContext(context);
    expect(rendered.length).toBe(6000);
    expect(rendered.endsWith('…')).toBe(true);
  });
});

describe('brain corpus WhatsApp cursor', () => {
  it('round-trips the deterministic account/chat tuple', () => {
    const value = { accountId: '+51922286663', chatId: '51911111111@s.whatsapp.net' };
    expect(decodeWhatsAppCursor(encodeWhatsAppCursor(value))).toEqual(value);
  });

  it('fails closed for malformed cursors', () => {
    expect(decodeWhatsAppCursor('not-base64-json')).toBeNull();
    expect(decodeWhatsAppCursor(Buffer.from('{}').toString('base64url'))).toBeNull();
  });
});

describe('brain corpus all-channel cursor', () => {
  it('round-trips the deterministic channel/account/chat tuple', () => {
    const value = { channel: 'instagram', accountId: 'faces', chatId: 'ig-chat-1' };
    expect(decodeConversationCursor(encodeConversationCursor(value))).toEqual(value);
  });
});

describe('brain corpus idempotent persistence', () => {
  it('requires an explicit Qdrant storage ownership flag', () => {
    const before = process.env.BRAIN_VECTOR_STORAGE_MODE;
    try {
      delete process.env.BRAIN_VECTOR_STORAGE_MODE;
      expect(qdrantOwnsKnowledgeEmbeddings()).toBe(false);
      process.env.BRAIN_VECTOR_STORAGE_MODE = 'qdrant';
      expect(qdrantOwnsKnowledgeEmbeddings()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.BRAIN_VECTOR_STORAGE_MODE;
      else process.env.BRAIN_VECTOR_STORAGE_MODE = before;
    }
  });

  it('skips document and chunk upserts when a prepared conversation is fully current', () => {
    expect(
      preparedConversationNeedsWrite({
        changedDocument: false,
        changedChunkKeys: new Set(),
        staleChunkKeys: [],
      }),
    ).toBe(false);
  });

  it('writes when document content, a chunk, or trailing chunk membership changed', () => {
    expect(
      preparedConversationNeedsWrite({
        changedDocument: true,
        changedChunkKeys: new Set(),
        staleChunkKeys: [],
      }),
    ).toBe(true);
    expect(
      preparedConversationNeedsWrite({
        changedDocument: false,
        changedChunkKeys: new Set(['raw:000000']),
        staleChunkKeys: [],
      }),
    ).toBe(true);
    expect(
      preparedConversationNeedsWrite({
        changedDocument: false,
        changedChunkKeys: new Set(),
        staleChunkKeys: ['raw:000001'],
      }),
    ).toBe(true);
  });
});

describe('brain corpus verified-empty source health', () => {
  it('promotes only idle discovery states and preserves real failure semantics', () => {
    expect(canPromoteVerifiedEmptyWhatsAppSource('discovered')).toBe(true);
    expect(canPromoteVerifiedEmptyWhatsAppSource('queued')).toBe(true);
    expect(canPromoteVerifiedEmptyWhatsAppSource('processing')).toBe(false);
    expect(canPromoteVerifiedEmptyWhatsAppSource('degraded')).toBe(false);
    expect(canPromoteVerifiedEmptyWhatsAppSource('failed')).toBe(false);
    expect(canPromoteVerifiedEmptyWhatsAppSource('ready')).toBe(false);
  });
});
