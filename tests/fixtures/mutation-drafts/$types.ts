import type { ComponentProps } from 'svelte';
import type Scheduling from '../../../src/routes/(app)/scheduling/settings/+page.svelte';

// The unchanged historical page imports its route-local generated type. Keep
// that type-only seam pointed at the actual current route contract here.
export type PageData = ComponentProps<typeof Scheduling>['data'];
