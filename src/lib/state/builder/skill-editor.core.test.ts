import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('$lib/services/gateway.svelte', () => ({ sendRequest: vi.fn() }));
vi.mock('$lib/state/gateway', () => ({ conn: { connected: false } }));
vi.mock('posthog-js', () => ({ default: { capture: vi.fn() } }));

import {
  saveSkill,
  skillEditorState,
  updateChapterPosition,
} from './skill-editor.core.svelte';

afterEach(() => {
  vi.unstubAllGlobals();
  skillEditorState.skillId = '';
  skillEditorState.dirty = false;
  skillEditorState.chapters = [];
});

describe('skill editor mutation failures', () => {
  test('keeps the draft dirty when autosave receives a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Save rejected' }, { status: 422 })),
    );
    skillEditorState.skillId = 'skill-1';
    skillEditorState.dirty = true;

    await saveSkill();

    expect(skillEditorState.dirty).toBe(true);
  });

  test('rolls an optimistic chapter move back when persistence fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Move rejected' }, { status: 409 })),
    );
    skillEditorState.skillId = 'skill-1';
    skillEditorState.chapters = [
      {
        id: 'chapter-1',
        name: 'Chapter',
        description: '',
        guide: '',
        context: '',
        outputDef: '',
        positionX: 10,
        positionY: 20,
      },
    ];

    await updateChapterPosition('chapter-1', 100, 200);

    expect(skillEditorState.chapters[0]).toMatchObject({ positionX: 10, positionY: 20 });
  });
});
