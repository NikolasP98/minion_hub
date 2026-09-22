import { page } from '$app/state';
import type { TableConfig } from './registry';

/** The active org's table-config document, loaded once by the app layout. */
export function tableConfig(): TableConfig {
  return ((page.data as { tableConfig?: TableConfig }).tableConfig ?? {}) as TableConfig;
}
