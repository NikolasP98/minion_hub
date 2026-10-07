// @vitest-environment happy-dom
/**
 * HC-027 — every `role="button"` control honours the WAI-ARIA button keyboard
 * contract: focusable, Enter and Space each activate exactly once (same path
 * as click), Space keydown never scrolls the page, and a key bubbling from a
 * NESTED control never activates the parent (HC-026).
 *
 * happy-dom does not synthesize native activation (Enter on a `<button>` →
 * click) nor compute focus rings; real Tab + Input.dispatchKeyEvent + computed
 * outline are proven in the Chromium pass (tests/fixtures/role-button-keys).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { Activity } from 'lucide-svelte';

import AgentGroupHeader from '$lib/components/agents/AgentGroupHeader.svelte';
import AgentDashboard from '$lib/components/agents/AgentDashboard.svelte';
import AgentSettingsPanel from '$lib/components/agents/AgentSettingsPanel.svelte';
import SubagentTreeNode from '$lib/components/agents/SubagentTreeNode.svelte';
import PipelineSidebar from '$lib/components/agents/_agent-prompt-simulator/PipelineSidebar.svelte';
import AgentCard from '$lib/components/marketplace/AgentCard.svelte';
import EmailCard from '$lib/components/my-agent/EmailCard.svelte';
import EventCard from '$lib/components/my-agent/EventCard.svelte';
import OmnichatDock from '$lib/components/my-agent/OmnichatDock.svelte';
import BreakdownTree from '$lib/components/prompt/BreakdownTree.svelte';
import KpiRow from '$lib/components/reliability/KpiRow.svelte';
import InboxOverlay from '$lib/components/workshop/InboxOverlay.svelte';
import MessageBoardOverlay from '$lib/components/workshop/MessageBoardOverlay.svelte';
import PortalOverlay from '$lib/components/workshop/PortalOverlay.svelte';
import RulebookOverlay from '$lib/components/workshop/RulebookOverlay.svelte';
import PinboardOverlay from '$lib/components/workshop/PinboardOverlay.svelte';
import RelationshipPrompt from '$lib/components/workshop/RelationshipPrompt.svelte';
import AgentSidebarHost from '../../../tests/fixtures/role-button-keys/AgentSidebarHost.svelte';
import AgentNodeHost from '../../../tests/fixtures/role-button-keys/AgentNodeHost.svelte';
import CodeEditorPane from '../../routes/(app)/tools/[id]/_components/CodeEditorPane.svelte';

import { ui } from '$lib/state/ui/ui.svelte';
import { gw } from '$lib/state/gateway/gateway-data.svelte';
import { conn } from '$lib/state/gateway/connection.svelte';
import { subagentState } from '$lib/state/features/subagent-data.svelte';
import { promptSections } from '$lib/state/features/prompt-sections.svelte';
import { agentGroupsState } from '$lib/state/features/agent-groups.svelte';
import { configState } from '$lib/state/config/config.svelte';
import { notesState } from '$lib/state/features/agent-notes.svelte';
import * as m from '$lib/paraglide/messages';
import { buttonKeys } from './button-keys';

vi.mock('$lib/state/features/agent-groups.svelte', async (orig) => ({
  ...(await orig<typeof import('$lib/state/features/agent-groups.svelte')>()),
  fetchAgentGroups: async () => [{ id: 'g1', name: 'Grouped', sortOrder: 0, memberAgentIds: ['a1'] }],
}));

type Mounted = {
  el: HTMLElement;
  /** Activation count (or 1/0 for idempotent state transitions). */
  count: () => number;
  /** A focusable control nested INSIDE `el`, when the site has one. */
  nested?: HTMLElement | null;
};
type Site = { site: string; tab: boolean; mount: () => Promise<Mounted> | Mounted };

function press(el: HTMLElement, key: string) {
  const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(down);
  el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
  return { scrollPrevented: down.defaultPrevented };
}
const q = (c: HTMLElement, sel: string) => c.querySelector<HTMLElement>(sel);
const roleButton = (c: HTMLElement, i = 0) =>
  c.querySelectorAll<HTMLElement>('[role="button"]')[i] as HTMLElement;

const okJson = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const sites: Site[] = [
  {
    site: 'AgentGroupHeader header row',
    tab: true,
    mount() {
      const onToggle = vi.fn();
      const v = render(AgentGroupHeader, {
        group: { id: 'g1', name: 'Group', sortOrder: 0, memberAgentIds: [] },
        onToggle,
        onRename: () => {},
        onDelete: () => {},
        onDrop: () => {},
        onDragOver: () => {},
        onDragLeave: () => {},
      });
      return {
        el: roleButton(v.container),
        count: () => onToggle.mock.calls.length,
        nested: q(v.container, 'button'),
      };
    },
  },
  ...[0, 1, 2].map((i) => ({
    site: `AgentDashboard card #${i + 1}`,
    tab: true,
    mount() {
      conn.connected = false;
      gw.sessions = [];
      ui.activeAgentTab = 'overview' as never;
      const v = render(AgentDashboard, {
        agentId: 'agent-alpha',
        agent: { id: 'agent-alpha', name: 'Alpha' } as never,
      });
      const el = roleButton(v.container, i);
      return {
        el,
        count: () => (ui.activeAgentTab === ('overview' as never) ? 0 : 1),
        nested: q(el, 'button'),
      };
    },
  })),
  {
    site: 'AgentSettingsPanel backdrop',
    tab: false,
    mount() {
      ui.agentSettingsOpen = true;
      gw.agents = [];
      const v = render(AgentSettingsPanel, { agentId: 'agent-alpha' });
      return { el: roleButton(v.container), count: () => (ui.agentSettingsOpen ? 0 : 1) };
    },
  },
  {
    site: 'SubagentTreeNode row',
    tab: true,
    mount() {
      subagentState.selectedKey = null;
      const session = (key: string) =>
        ({ key, label: key, displayName: key, updatedAt: 1, abortedLastRun: false }) as never;
      const v = render(SubagentTreeNode, {
        node: { session: session('k1'), children: [{ session: session('k2'), children: [] }] },
      });
      const el = roleButton(v.container);
      return {
        el,
        count: () => (subagentState.selectedKey === 'k1' ? 1 : 0),
        nested: q(el, 'button'),
      };
    },
  },
  {
    site: 'AgentSidebar ungrouped header',
    tab: true,
    async mount() {
      ui.selectedServerId = 'srv' as never;
      conn.connected = true;
      configState.loaded = true; // the sidebar's loadConfig effect re-runs forever without a gateway
      gw.agents = [
        { id: 'a1', name: 'Grouped agent', status: 'idle' },
        { id: 'a2', name: 'Loose agent', status: 'idle' },
      ] as never;
      agentGroupsState.ungroupedCollapsed = false;
      const v = render(AgentSidebarHost);
      await vi.waitFor(() => {
        if (!v.container.textContent?.includes('Ungrouped')) throw new Error('groups not loaded');
      });
      const el = v.container.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]');
      const header = [...el].find((e) => e.textContent?.includes('Ungrouped')) as HTMLElement;
      return { el: header, count: () => (agentGroupsState.ungroupedCollapsed ? 1 : 0) };
    },
  },
  {
    site: 'PipelineSidebar "overridden" badge',
    tab: true,
    mount() {
      const onToggleSection = vi.fn();
      const v = render(PipelineSidebar, {
        groupMode: 'none',
        sortMode: 'order',
        viewContext: 'inspect',
        hasSections: true,
        selectedSectionId: null,
        layerMeta: { identity: { label: 'Identity', color: '#000', description: '' } },
        sections: [{ id: 's1', layer: 'identity', label: 'S1', chars: 10, order: 1 }],
        classicSteps: [],
        activeStep: 0,
        stepStatus: {},
        testPrompt: '',
        testing: false,
        loading: false,
        disabledIds: new Set(['s1']),
        totalCount: 1,
        onSelectSection: () => {},
        onSelectStep: () => {},
        onToggleSection,
        onRunTest: () => {},
        onRefresh: () => {},
      });
      return {
        el: q(v.container, '[role="button"][tabindex="0"]') as HTMLElement,
        count: () => onToggleSection.mock.calls.length,
      };
    },
  },
  {
    site: 'flow-editor AgentNode body',
    tab: true,
    async mount() {
      const v = render(AgentNodeHost);
      // xyflow Handles are role=button tabindex=-1; the node body is the tabindex=0 one.
      await vi.waitFor(() => {
        if (!q(v.container, '[role="button"][tabindex="0"]')) throw new Error('node not rendered');
      });
      const el = q(v.container, '[role="button"][tabindex="0"]') as HTMLElement;
      // Activation toggles the settings panel: 1 when open (a double activation closes it again).
      return { el, count: () => (v.container.textContent?.includes(m.flow_defaultValues()) ? 1 : 0) };
    },
  },
  {
    site: 'marketplace AgentCard',
    tab: true,
    mount() {
      const v = render(AgentCard, {
        agent: {
          id: 'm1',
          name: 'Card Agent',
          role: 'Analyst',
          catchphrase: 'Hi',
          description: 'desc',
          tags: '[]',
          category: 'ops',
          version: '1',
          installCount: 0,
          avatarSeed: 'seed',
          archetype: 'copilot',
        } as never,
      });
      const el = roleButton(v.container);
      return {
        el,
        count: () => (el.classList.contains('flipped') ? 1 : 0),
        nested: q(el, 'button'),
      };
    },
  },
  {
    site: 'my-agent EmailCard',
    tab: true,
    mount() {
      const onopen = vi.fn();
      const v = render(EmailCard, {
        item: {
          id: 'e1',
          sourceEmail: 'me@x',
          from: 'A <a@x>',
          fromName: 'A',
          subject: 'Subj',
          date: '',
          receivedAt: null,
          snippet: '',
          labels: [],
        } as never,
        onopen,
        nowMs: 0,
      });
      return { el: roleButton(v.container), count: () => onopen.mock.calls.length };
    },
  },
  {
    site: 'my-agent EventCard',
    tab: true,
    mount() {
      const onopen = vi.fn();
      const v = render(EventCard, {
        item: {
          id: 'c1',
          sourceEmail: 'me@x',
          title: 'Meeting',
          startsAt: '2026-10-07T10:00:00Z',
          endsAt: '2026-10-07T11:00:00Z',
          isAllDay: false,
          location: null,
          htmlLink: null,
        } as never,
        onopen,
        nowMs: 0,
      });
      return { el: roleButton(v.container), count: () => onopen.mock.calls.length };
    },
  },
  {
    site: 'OmnichatDock conversation row',
    tab: true,
    async mount() {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          String(url).includes('view=conversations')
            ? okJson({ conversations: [{ channel: 'telegram', chatId: 'c1', content: 'hey', occurredAt: 0 }] })
            : okJson({ messages: [] }),
        ),
      );
      notesState.open = true; // the dock only polls while the notes panel is open
      const v = render(OmnichatDock);
      await vi.waitFor(() => {
        if (!q(v.container, '.row[role="button"]')) throw new Error('rows not loaded');
      });
      const el = q(v.container, '.row[role="button"]') as HTMLElement;
      return { el, count: () => (q(v.container, '.row[role="button"]') ? 0 : 1) };
    },
  },
  {
    site: 'prompt BreakdownTree section row',
    tab: true,
    mount() {
      promptSections.agentId = null;
      promptSections.preview = null;
      promptSections.selectedIds = new Set();
      promptSections.collapsedGroups = new Set();
      promptSections.sections = [
        { id: 's1', layer: 'identity', order: 1, source: 'builtin', enabled: true },
      ] as never;
      const v = render(BreakdownTree);
      const el = q(v.container, '[data-section-id="s1"]') as HTMLElement;
      return {
        el,
        count: () => (promptSections.selectedIds.has('s1') ? 1 : 0),
        nested: q(el, '[role="checkbox"]'),
      };
    },
  },
  {
    site: 'reliability KpiRow detail cell',
    tab: true,
    mount() {
      const onActivate = vi.fn();
      const v = render(KpiRow, {
        items: [{ key: 'k', label: 'Errors', value: '3', color: 'red', Icon: Activity, detail: { x: 1 } }] as never,
        cols: 8,
        onActivate,
      });
      return { el: roleButton(v.container), count: () => onActivate.mock.calls.length };
    },
  },
  {
    site: 'workshop InboxOverlay backdrop',
    tab: false,
    mount() {
      gw.agents = [];
      const onClose = vi.fn();
      const v = render(InboxOverlay, { elementId: 'el', onClose });
      return { el: roleButton(v.container), count: () => onClose.mock.calls.length };
    },
  },
  {
    site: 'workshop InboxOverlay file drop zone',
    tab: true,
    async mount() {
      gw.agents = [];
      const v = render(InboxOverlay, { elementId: 'el', onClose: () => {} });
      const open = [...v.container.querySelectorAll('button')].find((b) =>
        /new message/i.test(b.textContent ?? ''),
      ) as HTMLButtonElement;
      open.click();
      await tick();
      const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
      return {
        el: q(v.container, '[role="button"][tabindex="0"]') as HTMLElement,
        count: () => click.mock.calls.length,
      };
    },
  },
  ...(
    [
      ['MessageBoardOverlay', MessageBoardOverlay],
      ['PortalOverlay', PortalOverlay],
      ['RulebookOverlay', RulebookOverlay],
      ['PinboardOverlay', PinboardOverlay],
    ] as const
  ).map(([name, Comp]) => ({
    site: `workshop ${name} backdrop`,
    tab: false,
    mount() {
      const onClose = vi.fn();
      const v = render(Comp as never, { elementId: 'el', onClose } as never);
      return { el: roleButton(v.container), count: () => onClose.mock.calls.length };
    },
  })),
  {
    site: 'workshop RelationshipPrompt backdrop',
    tab: false,
    mount() {
      const onCancel = vi.fn();
      const v = render(RelationshipPrompt, {
        fromName: 'A',
        toName: 'B',
        x: 10,
        y: 10,
        onSubmit: () => {},
        onCancel,
      });
      return { el: roleButton(v.container), count: () => onCancel.mock.calls.length };
    },
  },
];

// happy-dom ships no window.confirm (AgentGroupHeader's Delete calls it) and no
// 2D canvas (AgentDashboard's ECharts sparkline paints one): inert stand-ins.
Object.assign(globalThis, { confirm: () => false });
const inertCtx: object = new Proxy({}, { get: () => () => inertCtx, set: () => true });
HTMLCanvasElement.prototype.getContext = (() => inertCtx) as never;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  conn.connected = false;
  gw.sessions = [];
  gw.agents = [];
  ui.agentSettingsOpen = false;
});

describe('HC-027 role="button" keyboard contract', () => {
  for (const s of sites) {
    it(s.site, async () => {
      for (const [key, name] of [
        ['Enter', 'Enter'],
        [' ', 'Space'],
      ] as const) {
        const { el, count, nested } = await s.mount();
        expect(el, `${s.site}: role=button control is rendered`).toBeTruthy();
        expect.soft(el.tabIndex === 0, `${s.site}: Tab-reachable (tabindex=0) = ${s.tab}`).toBe(s.tab);
        el.focus();
        expect.soft(document.activeElement, `${s.site}: focus() lands on the control`).toBe(el);
        const before = count();
        const { scrollPrevented } = press(el, key);
        await tick();
        expect.soft(count() - before, `${s.site}: ${name} activates exactly once`).toBe(1);
        if (key === ' ') {
          expect.soft(scrollPrevented, `${s.site}: Space keydown is prevented (no page scroll)`).toBe(true);
        }
        if (nested) {
          cleanup();
          const fresh = await s.mount();
          fresh.nested!.focus();
          const b2 = fresh.count();
          press(fresh.nested!, key);
          await tick();
          expect
            .soft(fresh.count() - b2, `${s.site}: ${name} on a nested control must NOT activate the parent`)
            .toBe(0);
        }
        cleanup();
        vi.restoreAllMocks();
      }
    });
  }

  it('CodeEditorPane drag sources are not announced as buttons and stay out of the tab order', () => {
    const v = render(CodeEditorPane, {
      scriptCode: '',
      scriptLang: 'js' as never,
      defaultCode: {},
      envVars: [{ key: 'A', value: '1', revealed: false }],
      envVarsExpanded: true,
      isAdmin: true,
      variablesData: { system: [{ key: 'now', description: 'd' }], module: [], database: [] },
      schemaCatalog: null,
      onCodeChange: () => {},
      onAddEnvVar: () => {},
      onRemoveEnvVar: () => {},
      onToggleReveal: () => {},
      onToggleExpanded: () => {},
    });
    const drags = [...v.container.querySelectorAll<HTMLElement>('[draggable="true"]')];
    expect(drags.length).toBeGreaterThan(0);
    for (const d of drags) {
      expect.soft(d.getAttribute('role'), 'drag source must not claim role=button').not.toBe('button');
      expect.soft(d.hasAttribute('tabindex'), 'drag source is not a tab stop').toBe(false);
    }
  });

  it('buttonKeys helper: Enter on keydown, Space on keyup, nested keys ignored, no double fire', async () => {
    const activate = vi.fn();
    const keys = buttonKeys(activate);
    const el = document.createElement('div');
    const child = document.createElement('button');
    el.appendChild(child);
    document.body.appendChild(el);
    el.addEventListener('keydown', keys.onkeydown);
    el.addEventListener('keyup', keys.onkeyup);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(activate).toHaveBeenCalledTimes(1);
    const down = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', cancelable: true }));
    expect(activate).toHaveBeenCalledTimes(2);
    // keyup without a prior keydown on this element (focus moved mid-press) is ignored
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', cancelable: true }));
    expect(activate).toHaveBeenCalledTimes(2);
    // keys bubbling from a nested control never activate the parent
    child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    child.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    child.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
    expect(activate).toHaveBeenCalledTimes(2);
    // default activation path is the element's own click
    const clicked = buttonKeys();
    const d2 = document.createElement('div');
    let clicks = 0;
    d2.addEventListener('click', () => clicks++);
    d2.addEventListener('keydown', clicked.onkeydown);
    d2.addEventListener('keyup', clicked.onkeyup);
    d2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    d2.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));
    d2.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', cancelable: true }));
    expect(clicks).toBe(2);
    el.remove();
  });
});
