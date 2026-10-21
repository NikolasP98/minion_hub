<script lang="ts">
  import { Button } from '@minion-stack/ui';
  import { page } from '$app/state';
  import { createOptimistic } from '$lib/utils/optimistic';
  let owner = $state('one');
  $effect.pre(() => {
    page.data = { user: { id: owner }, activeOrgId: 'org' };
  });
  const edits = createOptimistic<boolean>();
  let finish: () => void = () => {};
  const visible = $derived.by(() => {
    // Derive again on identity change, as the real page's data would do.
    void owner;
    return edits.get('row', false);
  });
</script>

<Button
  onclick={() =>
    void edits.run(
      'row',
      true,
      () =>
        new Promise<boolean>((resolve) => {
          finish = () => resolve(true);
        }),
    )}>Edit</Button
>
<Button
  onclick={() => {
    owner = 'two';
  }}>Switch owner</Button
>
<Button onclick={() => finish()}>Finish old write</Button>
<output>{String(visible)}</output>
