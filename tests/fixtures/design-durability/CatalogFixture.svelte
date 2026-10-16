<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import CatalogPage from '../../../src/routes/(app)/pos/catalog/+page.svelte';
  import Shell from '../mobile-composition/Shell.svelte';
  import { setLanguageTag } from '$lib/paraglide/runtime';
  const params = new URLSearchParams(location.search);
  setLanguageTag(params.get('lang') === 'es' ? 'es' : 'en');
  const row = {
    productId: 'fixture-catalog-one',
    code: 'FIX-01',
    name: 'Consulta integral y seguimiento personalizado prolongado',
    category: 'Consultas',
    unitPrice: 150,
    active: true,
    kind: 'service',
    itemId: null,
    stockQty: null,
    hasMapping: false,
    packageSessions: 0,
    consumedItemNames: [],
    taxonomy: { kind: 'service', zone: null, line: null },
    tags: [],
    inheritedTags: [],
    billed: 0,
    revenue: 0,
    cost: null,
    margin: null,
    marginPct: null,
    costable: false,
    partial: false,
    costMasked: true,
  };
  const data = {
    activeOrgId: 'fixture-org',
    sellables: params.get('state') === 'empty' ? [] : [row],
    catalogTags: [],
    categories: [],
    stockItems: [],
    componentEdges: [],
    stockEnabled: false,
    customProperties: {
      definitions: [],
      values: {},
      recordAccess: {},
      canManage: false,
      canEdit: false,
    },
  } as unknown as ComponentProps<typeof CatalogPage>['data'];
</script>

<Shell><CatalogPage {data} /></Shell>
