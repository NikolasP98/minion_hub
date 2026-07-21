import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readComponent = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('account full-sync UI contract', () => {
  it('keeps WhatsApp QR pairing in the setup wizard, not the identity claim card', () => {
    const claimCard = readComponent('./WhatsAppClaimCard.svelte');
    const wizard = readComponent('../channels/ChannelSetupWizard.svelte');

    expect(claimCard).not.toContain('WhatsAppQrPairing');
    expect(wizard).toContain('<WhatsAppQrPairing');
  });

  it('shows a busy state while the wizard saves and waits for the gateway', () => {
    const wizard = readComponent('../channels/ChannelSetupWizard.svelte');

    expect(wizard).toContain('loading={committing}');
    expect(wizard).toContain('m.channelWizard_savingHint()');
    expect(wizard).toContain('aria-live="polite"');
  });

  it('derives WhatsApp integration health from a matching gateway account', () => {
    const linking = readComponent('./ChannelLinking.svelte');

    expect(linking).toContain('matchClaimedAccount');
    expect(linking).toContain('deriveWhatsAppAccountState');
    expect(linking).toContain('accountState={whatsappAccountState}');
    expect(linking).not.toContain('m.usersui_fullSyncConnected()');
  });

  it('keeps sync setup exclusive to WhatsApp', () => {
    const linking = readComponent('./ChannelLinking.svelte');
    const whatsapp = readComponent('./WhatsAppClaimCard.svelte');
    const telegram = readComponent('./TelegramClaimCard.svelte');

    expect(whatsapp).toContain('m.usersui_setupSync()');
    expect(telegram).not.toContain('usersui_setupSync');
    expect(linking).not.toContain("wizardType = 'telegram'");
  });

  it('shows the claimed identity inline and removes the connected-as accordions', () => {
    const whatsapp = readComponent('./WhatsAppClaimCard.svelte');
    const telegram = readComponent('./TelegramClaimCard.svelte');

    expect(whatsapp).toContain('{identity.externalId}');
    expect(whatsapp).toContain('{displayName}');
    expect(telegram).toContain('{identity.externalId}');
    expect(telegram).toContain('{displayName}');
    expect(whatsapp).not.toContain('Connected as');
    expect(telegram).not.toContain('Connected as');
    expect(whatsapp).not.toContain('ChevronDown');
    expect(telegram).not.toContain('ChevronDown');
  });
});
