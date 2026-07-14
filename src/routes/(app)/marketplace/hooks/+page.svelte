<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
</script>

<PageShell archetype="collection" scroll="region" labelledBy="marketplace-hooks-title">
  <PageHeader title={m.marketplace_hooks()} titleId="marketplace-hooks-title" />
  <PageBody scroll="region">
    <AsyncBoundary
      state={{
        kind: 'empty',
        title: m.marketplace_hooks(),
        description: m.marketplace_comingSoon(),
      }}
    />
  </PageBody>
</PageShell>
