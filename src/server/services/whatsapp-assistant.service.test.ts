import { describe, it, expect, vi } from 'vitest';
vi.mock('$server/db/pg-pool', () => ({ getPgClient: vi.fn() }));
import { validateWhatsAppSender, whatsappString } from './whatsapp-assistant.service';
describe('WhatsApp trusted sender envelope', () => {
  it('requires a canonical provider phone/JID pair and direct chat', () => {
    expect(
      validateWhatsAppSender({
        senderPhone: '19995550102',
        senderJid: '19995550102@s.whatsapp.net',
        chatKind: 'direct',
      }),
    ).toEqual({ phone: '19995550102', jid: '19995550102@s.whatsapp.net' });
    for (const change of [
      { senderPhone: '+19995550102' },
      { senderJid: '123@lid' },
      { senderJid: '19995550109@s.whatsapp.net' },
      { chatKind: 'group' },
      { senderPhone: '000000000' },
    ]) {
      expect(() =>
        validateWhatsAppSender({
          senderPhone: '19995550102',
          senderJid: '19995550102@s.whatsapp.net',
          chatKind: 'direct',
          ...change,
        }),
      ).toThrow();
    }
  });
  it('rejects missing, control-character and oversized identifiers before SQL', () => {
    for (const value of [null, 22, {}, '', 'bad\nvalue', 'a'.repeat(201)])
      expect(() => whatsappString({ id: value }, 'id')).toThrow();
  });
});
