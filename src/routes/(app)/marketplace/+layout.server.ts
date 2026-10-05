import type { LayoutServerLoad } from './$types';

/** Catalog reads never start global synchronization; the durable cron owns it. */
export const load: LayoutServerLoad = async () => ({});
