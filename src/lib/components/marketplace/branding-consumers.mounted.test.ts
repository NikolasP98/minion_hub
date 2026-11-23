// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { consumerPage } from '../../../../tests/fixtures/branding/consumer-page.svelte';
import { resolveBranding } from '$lib/branding';
import type { MarketplaceAgent } from '$lib/state/features/marketplace.svelte';
import * as m from '$lib/paraglide/messages';
import { setLanguageTag } from '$lib/paraglide/runtime';

vi.mock('$app/state', async () => ({
  page: (await import('../../../../tests/fixtures/branding/consumer-page.svelte')).consumerPage,
}));
import AgentCard from './AgentCard.svelte';
import IdFooter from './_agent-card/IdFooter.svelte';
import IdBadgeCard from '../../../routes/(app)/marketplace/agents/[slug]/_components/IdBadgeCard.svelte';
import AgentCreatorWizard from './AgentCreatorWizard.svelte';
import MarketplacePlugins from '../../../routes/(app)/marketplace/plugins/+page.svelte';
import WelcomePanel from '../layout/WelcomePanel.svelte';
import OAuthAuthorize from '../../../routes/oauth/authorize/+page.svelte';
import Onboarding from '../../../routes/onboarding/+page.svelte';

const agent: MarketplaceAgent = {
  id: 'agent-minion-content',
  name: 'Minion user agent',
  role: 'MINION engineer',
  category: 'engineering',
  tags: '["minion-package"]',
  description: 'User content about Minion Drone.',
  catchphrase: null,
  version: '1.0',
  model: null,
  archetype: 'copilot',
  avatarSeed: 'minion',
  githubPath: 'minions/example',
  installCount: 0,
  syncedAt: '2026-11-22T00:00:00Z',
  createdAt: '2026-11-22T00:00:00Z',
  updatedAt: '2026-11-22T00:00:00Z',
};
const selectBrand = (name: string, orgId = name) => {
  consumerPage.data = { branding: resolveBranding({ id: orgId, name, hub_name: name }) };
};
beforeEach(() => {
  setLanguageTag('en');
  selectBrand('Faces');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLanguageTag('en');
});

describe('remaining Hub identity consumers execute the request-owned projection', () => {
  it('replaces card/footer/detail identity when the active organization changes, preserving authored agent text', async () => {
    const card = render(AgentCard, { agent });
    const footer = render(IdFooter, { onFlip: vi.fn() });
    const badge = render(IdBadgeCard, { agent });
    const brandNodes = () => [
      card.container.querySelector('.company-brand'),
      footer.container.querySelector('.company-brand'),
      badge.container.querySelector('.company-brand'),
    ];
    expect(brandNodes().map((el) => el?.textContent)).toEqual(['Faces', 'Faces', 'Faces']);
    expect(card.container.querySelector('.id-card')?.getAttribute('data-brand-watermark')).toBe(
      'Faces  '.repeat(100),
    );
    expect(card.container.textContent).toContain(agent.name);
    expect(card.container.textContent).toContain(agent.role);
    expect(badge.container.textContent).toContain(agent.name);
    selectBrand('Orbit');
    await tick();
    expect(brandNodes().map((el) => el?.textContent)).toEqual(['Orbit', 'Orbit', 'Orbit']);
    expect(card.container.querySelector('.id-card')?.getAttribute('data-brand-watermark')).toBe(
      'Orbit  '.repeat(100),
    );
    expect(card.container.textContent).toContain(agent.name);
    consumerPage.data = { branding: undefined };
    await tick();
    expect(brandNodes().map((el) => el?.textContent)).toEqual(['MINION', 'MINION', 'MINION']);
  });

  it.each(['<b>Faces</b>', 'WWWWWWWWWWWWWWW', '漢'.repeat(15), '👩🏽‍💻'.repeat(15)])(
    'renders accepted names as literal text and an inert watermark attribute: %s',
    async (name) => {
      selectBrand(name);
      const card = render(AgentCard, { agent });
      expect(card.container.querySelector('.company-brand')?.textContent).toBe(name);
      expect(card.container.querySelector('.id-card')?.getAttribute('data-brand-watermark')).toBe(
        `${name}  `.repeat(100),
      );
      expect(card.container.querySelector('.company-brand b')).toBeNull();
      expect(card.container.querySelector('.id-card')?.getAttribute('style')).toBeNull();
    },
  );

  it.each(['en', 'es'] as const)(
    'localizes the actual welcome heading and updates it after organization selection: %s',
    async (lang) => {
      setLanguageTag(lang);
      const view = render(WelcomePanel);
      expect(view.getByRole('heading', { level: 1 }).textContent).toBe(
        lang === 'en' ? 'Welcome to Faces Hub' : 'Bienvenido a Faces Hub',
      );
      selectBrand('Clínica');
      await tick();
      expect(view.getByRole('heading', { level: 1 }).textContent).toBe(
        lang === 'en' ? 'Welcome to Clínica Hub' : 'Bienvenido a Clínica Hub',
      );
    },
  );

  it.each(['en', 'es'] as const)(
    'renders localized plugin identity and the final real wizard step: %s',
    async (lang) => {
      setLanguageTag(lang);
      const plugins = render(MarketplacePlugins);
      expect(plugins.container.textContent).toContain(
        lang === 'en'
          ? 'Find and install plugins that extend Faces Hub'
          : 'Encuentra e instala plugins que amplían Faces Hub',
      );
      selectBrand('Orbit');
      await tick();
      expect(plugins.container.textContent).toContain(
        lang === 'en'
          ? 'Find and install plugins that extend Orbit Hub'
          : 'Encuentra e instala plugins que amplían Orbit Hub',
      );
      plugins.unmount();
      const generated = {
        soulMd: '# A user-authored agent',
        identityMd: '',
        userMd: '',
        contextMd: '',
        skillsMd: '',
        agentJson: { ...agent, tags: [], catchphrase: '' },
      };
      const generate = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(generated), { status: 200 }));
      vi.stubGlobal('fetch', generate);
      const wizard = render(AgentCreatorWizard, { onClose: vi.fn() });
      await fireEvent.input(wizard.getByLabelText(m.marketplace_wizardStep1RoleLabel()), {
        target: { value: agent.role },
      });
      await fireEvent.click(wizard.getByRole('button', { name: m.marketplace_wizardNext() }));
      await fireEvent.input(wizard.getByLabelText(m.marketplace_wizardStep2NameLabel()), {
        target: { value: agent.name },
      });
      await fireEvent.click(wizard.getByRole('button', { name: m.marketplace_wizardNext() }));
      await fireEvent.click(
        wizard.getByRole('button', { name: m.marketplace_wizardStep3Generate() }),
      );
      await waitFor(() =>
        expect(wizard.getByRole('button', { name: m.marketplace_wizardExport() })).toBeTruthy(),
      );
      await fireEvent.click(wizard.getByRole('button', { name: m.marketplace_wizardExport() }));
      expect(wizard.container.textContent).toContain(
        lang === 'en' ? 'Then sync in Orbit Hub:' : 'Luego sincroniza en Orbit Hub:',
      );
      expect(wizard.container.textContent).toContain('cd ~/nikolasp98/minions');
      selectBrand('Faces');
      await tick();
      expect(wizard.container.textContent).toContain(
        lang === 'en' ? 'Then sync in Faces Hub:' : 'Luego sincroniza en Faces Hub:',
      );
      expect(generate).toHaveBeenCalledExactlyOnceWith(
        '/api/marketplace/generate-agent',
        expect.objectContaining({ method: 'POST' }),
      );
    },
  );

  it.each(['en', 'es'] as const)(
    'keeps the OAuth app interpolation and a prefix-only personal welcome: %s',
    async (lang) => {
      setLanguageTag(lang);
      const oauth = render(OAuthAuthorize, {
        data: {
          valid: true,
          appName: 'Example MCP Client',
          orgs: [{ id: 'faces', name: 'Faces organization' }],
          registeredAt: Date.now(),
          redirectUri: 'https://example.com/callback',
          refused: null,
        } as never,
      });
      expect(oauth.getByRole('heading', { level: 1 }).textContent).toBe(
        lang === 'en'
          ? 'Example MCP Client wants to connect to Faces Hub'
          : 'Example MCP Client quiere conectarse a Faces Hub',
      );
      expect(document.title).toContain('Faces Hub');
      oauth.unmount();
      const onboarding = render(Onboarding, {
        data: {
          scope: 'user',
          user: { displayName: 'Minion user', email: 'minion@example.com' },
          languages: ['en', 'es'],
        } as never,
        form: null,
      });
      expect(onboarding.getByRole('heading', { level: 1 }).textContent).toBe(
        lang === 'en' ? 'Welcome to Faces' : 'Bienvenido a Faces',
      );
      expect(document.title).toContain('Faces Hub');
      selectBrand('Orbit');
      await tick();
      expect(onboarding.getByRole('heading', { level: 1 }).textContent).toBe(
        lang === 'en' ? 'Welcome to Orbit' : 'Bienvenido a Orbit',
      );
      expect(document.title).toContain('Orbit Hub');
    },
  );
});
