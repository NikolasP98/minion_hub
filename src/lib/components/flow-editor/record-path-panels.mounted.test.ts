// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { kitParams } from '../../../../tests/fixtures/card-actions/kit-route';
import FlowExports from './FlowExports.svelte';
import FlowCopilotPanel from './FlowCopilotPanel.svelte';
import FlowHistoryPanel from './FlowHistoryPanel.svelte';
import { flowEditorState } from '$lib/state/features/flow-editor.svelte';

vi.mock('$lib/services/gateway.svelte', () => ({ sendRequest: vi.fn() }));
vi.mock('$lib/state/gateway', () => ({ conn: { connected: false } }));
// The real alias adapter stays dormant without browser identity in this
// transport fixture. Its browser lifecycle has dedicated actual-consumer tests.
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  flowEditorState.historyOpen = false;
  flowEditorState.flowId = null;
});

it('export toggle PATCH reaches the same decoded flow and keeps variable payload raw', async () => {
  const id = 'flow/%2F/東京';
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    expect(kitParams('/api/flows/[id]/exports', input)?.id).toBe(id);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(String(init?.body))).toEqual({ varKey: 'report/%2F', enabled: false });
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(FlowExports, {
    flowId: id,
    canEdit: true,
    toggles: {},
    specs: [{ key: 'report/%2F', label: 'Report', type: 'string' }],
  });
  await fireEvent.click(view.getByRole('switch', { name: 'Report' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(view.getByRole('switch', { name: 'Report' }).getAttribute('aria-checked')).toBe('false');
});

it('copilot POST uses the decoded selected flow after a native composer action', async () => {
  const id = 'flow/%2F/東京';
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    expect(kitParams('/api/flows/[id]/copilot', input)?.id).toBe(id);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      messages: [{ role: 'user', content: 'Inspect /%2F' }],
    });
    return Response.json({
      message: '',
      proposedFlow: { nodes: [], edges: [] },
      validation: { ok: true, issues: [] },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const preview = vi.fn();
  const view = render(FlowCopilotPanel, {
    flowId: id,
    onpreview: preview,
    onapply: () => true,
    onreject: () => {},
  });
  await fireEvent.input(view.getByRole('textbox'), { target: { value: 'Inspect /%2F' } });
  await fireEvent.click(view.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(preview).toHaveBeenCalledExactlyOnceWith({ nodes: [], edges: [] }));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('opening history GET uses the selected flow ID with encoded delimiters', async () => {
  const id = 'flow/%2F/東京';
  const fetcher = vi.fn(async (input: string) => {
    expect(kitParams('/api/flows/[id]/runs', input)?.id).toBe(id);
    return Response.json({ runs: [] });
  });
  vi.stubGlobal('fetch', fetcher);
  flowEditorState.flowId = id;
  flowEditorState.historyOpen = true;
  render(FlowHistoryPanel);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
});
