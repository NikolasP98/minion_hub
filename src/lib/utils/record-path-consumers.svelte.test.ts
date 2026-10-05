import { afterEach, describe, expect, it, vi } from 'vitest';
import { kitParams } from '../../../tests/fixtures/card-actions/kit-route';
import {
  loadSkill,
  saveSkill,
  saveChapterEdits,
  publishSkill,
  skillEditorState,
} from '$lib/state/builder/skill-editor.core.svelte';
import {
  loadFlow,
  saveFlow,
  runFlow,
  flowEditorState,
} from '$lib/state/features/flow-editor.svelte';
import { sendRequest } from '$lib/services/gateway.svelte';
import { conn } from '$lib/state/gateway';
import { deleteWorkspaceSave } from '$lib/state/workshop/workshop.svelte';

vi.mock('$lib/services/gateway.svelte', () => ({ sendRequest: vi.fn() }));
vi.mock('$lib/state/gateway', () => ({ conn: { connected: false } }));
vi.mock('$lib/state/features/hosts.svelte', () => ({
  hostsState: { activeHostId: null, hosts: [] },
}));
vi.mock('$lib/state/workshop/workshop.memory.svelte', () => ({ loadMemory: vi.fn() }));
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
  skillEditorState.skillId = '';
  skillEditorState.chapters = [];
  skillEditorState.editingChapter = null;
  flowEditorState.flowId = null;
  conn.connected = false;
});

describe('real data consumers preserve decoded record IDs', () => {
  it.each(['folder/record', 'literal%2F', 'two words', '東京/ñ'])(
    'skill GET, autosave, chapter GET/PUT and raw payloads for %j',
    async (id) => {
      const chapterId = `chapter/${id}`;
      const calls: Array<{
        method: string;
        params: Record<string, string>;
        body: Record<string, unknown>;
      }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init?: RequestInit) => {
          const nested = input.includes('/chapter-tools/');
          const params = kitParams(
            nested
              ? '/api/builder/skills/[id]/chapter-tools/[chapterId]'
              : '/api/builder/skills/[id]',
            input,
          );
          // This assertion observes the actual fetch input through the installed
          // server matcher; a slash or second decoding would select another ID.
          expect(params?.id).toBe(id);
          if (nested) expect(params?.chapterId).toBe(chapterId);
          calls.push({
            method: init?.method ?? 'GET',
            params: params!,
            body: init?.body ? JSON.parse(String(init.body)) : {},
          });
          if (nested) return Response.json({ toolIds: ['tool/a'] });
          return Response.json({
            ok: true,
            skill: { name: 'Fixture', status: 'draft' },
            chapters: [
              {
                id: chapterId,
                name: 'Chapter',
                description: '',
                guide: '',
                context: '',
                outputDef: '',
                positionX: 0,
                positionY: 0,
              },
            ],
            edges: [],
          });
        }),
      );
      await loadSkill(id);
      expect(skillEditorState.skillId).toBe(id);
      expect(skillEditorState.chapterToolMap[chapterId]).toEqual(['tool/a']);
      await saveSkill();
      skillEditorState.editingChapter = skillEditorState.chapters[0];
      await saveChapterEdits({
        name: 'Edited',
        description: '',
        guide: '',
        context: '',
        outputDef: '',
        toolIds: ['tool/a'],
      });
      expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'PUT', 'PUT', 'PUT']);
      expect(calls[3].body.chapterId).toBe(chapterId);
      expect(calls[4].body.toolIds).toEqual(['tool/a']);
    },
  );

  it('flow load and save preserve percent/slash IDs through the server route', async () => {
    const id = 'flow/%2F/東京';
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        expect(kitParams('/api/flows/[id]', input)?.id).toBe(id);
        calls.push(init?.method ?? 'GET');
        return Response.json({ flow: { name: 'Fixture', nodes: [], edges: [] }, ok: true });
      }),
    );
    await loadFlow(id);
    await saveFlow();
    expect(calls).toEqual(['GET', 'PUT']);
    expect(flowEditorState.flowId).toBe(id);
  });

  it('publish and gateway-run history use the logical ID only inside their URL segment', async () => {
    const id = 'record/%2F/東京';
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const route = input.startsWith('/api/builder')
          ? '/api/builder/skills/[id]'
          : '/api/flows/[id]/runs';
        expect(kitParams(route, input)?.id).toBe(id);
        calls.push({ url: input, body: JSON.parse(String(init?.body)) });
        return Response.json({ ok: true });
      }),
    );
    skillEditorState.skillId = id;
    skillEditorState.name = 'Publish fixture';
    skillEditorState.description = 'Complete description';
    skillEditorState.dirty = false;
    skillEditorState.chapters = [
      {
        id: 'chapter',
        name: 'Step',
        description: '',
        context: '',
        guide: 'Run the lookup',
        outputDef: 'Lookup result',
        positionX: 0,
        positionY: 0,
      },
    ];
    skillEditorState.chapterToolMap = { chapter: ['lookup'] };
    await publishSkill();
    expect(calls[0]?.body).toEqual({ action: 'publish' });
    flowEditorState.flowId = id;
    flowEditorState.nodes = [];
    flowEditorState.edges = [];
    conn.connected = true;
    vi.mocked(sendRequest).mockResolvedValue({
      events: [{ kind: 'run-end', level: 'info', message: 'Fixture done' }],
    });
    await runFlow();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body.source).toBe('test');
    expect(calls[1].body.status).toBe('completed');
  });

  it('workshop DELETE stays on the selected record and rejects parent identifiers before fetch', async () => {
    const id = 'workspace/%2F/name';
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      expect(kitParams('/api/workshop/saves/[id]', input)?.id).toBe(id);
      expect(init?.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetcher);
    await deleteWorkspaceSave(id);
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const invalid of ['', '.', '..'])
      await expect(deleteWorkspaceSave(invalid)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
