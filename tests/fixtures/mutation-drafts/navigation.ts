import { transport } from './state.svelte';
export async function goto(): Promise<never> {
  throw new Error('Route navigation is outside this isolated component fixture');
}
export async function invalidate() {
  transport.reads++;
  if (transport.nextReadFails) {
    transport.nextReadFails = false;
    throw new Error('Synthetic failed read');
  }
}
