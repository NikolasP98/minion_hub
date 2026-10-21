import { describe, expect, it } from 'vitest';
// The executable scanner is shared with CI, not reimplemented in this test.
import { inventory } from './optimistic-controls.mjs';
describe('optimistic edit CI gate', () => {
  it('rejects a server-waiting control even if an unrelated optimistic helper is imported', () => {
    const source = `<script lang="ts">
      import { createOptimistic } from '$lib/utils/optimistic';
      const unrelated = createOptimistic(); let data;
      async function save(v) { await fetch('/api/item', {method:'PATCH'}); }
    </script><Toggle checked={data.enabled} onchange={save} />`;
    expect(inventory(source)).toHaveLength(1);
  });
  it('accepts a control wired to its own optimistic overlay, but detects an unwired one', () => {
    const script = `<script>import {createOptimistic} from './optimistic';
      const enabled = createOptimistic(); let row;
      async function save(v) { await enabled.run(row.id,v,async()=>fetch('/api/item',{method:'PATCH'})); }
      </script>`;
    expect(
      inventory(script + '<Toggle checked={enabled.get(row.id,row.enabled)} onchange={save} />'),
    ).toEqual([]);
    expect(inventory(script + '<Toggle checked={row.enabled} onchange={save} />')).toHaveLength(1);
  });
  it('follows spread-based projections without mistaking property names for variables', () => {
    const source = `<script>import {createOptimistic} from './optimistic';
      let data; const edits=createOptimistic();
      const row=$derived({...data.row,...edits.get(data.row.id,{})});
      async function save(v){await edits.run(row.id,v,async()=>fetch('/api/item',{method:'PATCH'}));}
      </script><Select value={row.status} onchange={save} />`;
    expect(inventory(source)).toEqual([]);
  });
  it('follows local handler aliases and treats bound form drafts separately', () => {
    const source = `<script>let data, draft; const change = v => save(v);
      async function save(v) {await fetch('/api/item',{method:'PATCH'});}</script>
      <Select value={data.status} onchange={change} /><Input bind:value={draft} />`;
    expect(inventory(source)).toHaveLength(1);
  });
});

it('requires async tag callbacks to retain their promise', () => {
  const setup = `<script>let data; async function save(ids){await fetch('/api/tags',{method:'PUT'});}</script>`;
  expect(inventory(setup + '<TagsField value={data.ids} onchange={save} />')).toEqual([]);
  expect(
    inventory(setup + '<TagsField value={data.ids} onchange={(ids)=>void save(ids)} />'),
  ).toHaveLength(1);
});
