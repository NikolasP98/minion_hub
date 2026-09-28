/**
 * Table kit — page-side concerns that are generic but not table-internal,
 * next to the component the way `scheduling/kit/` sits next to the calendar
 * (spec 2026-09-28 §T2). Nothing here imports a route or a module domain.
 */
export {
  createTableUrlState,
  type TableUrlState,
  type TableUrlStateOptions,
  type TableUrlStateKey,
  type TableSort,
  type TableFilterValue,
  type TableFilterRange,
} from './url-state.svelte';
export { serverQueryToParams, paramsToServerQuery, type ServerQueryMap } from './server-query';
export {
  createOptimisticCell,
  type OptimisticCell,
  type OptimisticCellOptions,
} from './optimistic-cell';
