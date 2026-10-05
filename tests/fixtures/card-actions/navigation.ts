import { record } from './state.svelte';
export async function invalidate() {}
export async function goto(url: string | URL) {
  record(`goto:${String(url)}`);
}
