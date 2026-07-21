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

  it('replaces the setup action with a connected confirmation after live gateway confirmation', () => {
    const linking = readComponent('./ChannelLinking.svelte');

    expect(linking).toContain('whatsappFullSyncConnected');
    expect(linking).toContain('account.connected === true');
    expect(linking).toContain('m.usersui_fullSyncConnected()');
  });
});
