import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativeToSrc: string): string {
  return readFileSync(new URL(`../../${relativeToSrc}`, import.meta.url), 'utf8');
}

describe('high-risk mutation integration contracts', () => {
  it.each([
    'routes/(app)/scheduling/resources/+page.svelte',
    'routes/(app)/memberships/+page.svelte',
    'routes/(app)/work/+page.svelte',
    'routes/(app)/settings/workflows/+page.svelte',
    'routes/(app)/settings/notifications/+page.svelte',
    'routes/(app)/flow-editor/[id]/+page.svelte',
  ])('%s has no unchecked raw fetch path', (path) => {
    const text = source(path);
    expect(text).toContain('jsonMutation');
    expect(text).not.toMatch(/\bfetch\s*\(/);
  });

  it('availability commits its clean baseline only in the success callback', () => {
    const text = source('lib/components/scheduling/AvailabilityEditor.svelte');
    expect(text).toContain('jsonMutation');
    expect(text).toContain('onSuccess: async () =>');
    expect(text).toContain('baseline = serialize(week)');
    expect(text).not.toMatch(/\bfetch\s*\(/);
  });

  it('brain deletion navigates only through jsonMutation onSuccess', () => {
    const text = source('routes/(app)/brains/[id]/+page.svelte');
    expect(text).toContain("init: { method: 'DELETE' }");
    expect(text).toContain("onSuccess: () => goto('/brains')");
    expect(text).not.toContain("await goto('/brains');");
  });

  it('home activity cards do not pass focusable no-op actions', () => {
    const home = source('routes/(app)/home/+page.svelte');
    const card = source('lib/components/my-agent/FeedCard.svelte');
    expect(home).not.toMatch(/on(?:snooze|dismiss|open)=\{\(\) => \{\}\}/);
    expect(card).toContain('{#if onopen}');
    expect(card).toContain('<Button');
    expect(card).toContain('onclick={onopen}');
    expect(card).toContain('<div class="body">');
    expect(card).not.toContain('role={onopen');
  });

  it('flow apply clears its proposal preview only inside the confirmed-success callback', () => {
    const text = source('routes/(app)/flow-editor/[id]/+page.svelte');
    const apply = text.slice(
      text.indexOf('async function onApply'),
      text.indexOf('function onReject'),
    );
    const successCallback = apply.indexOf('onSuccess: () =>');
    const clearPreview = apply.indexOf('flowEditorState.previewDiff = null');

    expect(successCallback).toBeGreaterThan(-1);
    expect(clearPreview).toBeGreaterThan(successCallback);
    expect(apply).toContain('Keep the proposal preview and backup intact');
  });

  it('BackupsTab allowlists exactly the two response-stream fetches', () => {
    const text = source('lib/components/settings/BackupsTab.svelte');
    const rawFetches = text.match(/\bfetch\s*\(/g) ?? [];
    expect(rawFetches).toHaveLength(2);
    expect(text).toMatch(/fetch\(`\/api\/servers\/\$\{hostsState\.activeHostId\}\/backups\/run`/);
    expect(text).toMatch(
      /fetch\(`\/api\/servers\/\$\{hostsState\.activeHostId\}\/backups\/restore`/,
    );
    expect(text).toContain(
      'input: `/api/servers/${hostsState.activeHostId}/backups/${snapshot.id}`',
    );
  });
});
