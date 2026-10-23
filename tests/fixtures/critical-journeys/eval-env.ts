import { bootstrap } from './eval-page.svelte';
export const env = { PUBLIC_ASSISTANT_ROUTER: bootstrap?.arm === 'full' ? 'off' : 'enforce' };
export const PUBLIC_GATEWAY_URL = '';
