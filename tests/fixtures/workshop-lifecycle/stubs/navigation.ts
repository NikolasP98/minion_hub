export * from '../../../../src/server/test-utils/env-stubs/app-navigation';
export async function goto(url: string | URL) {
  (globalThis as unknown as { __hc037: { gotos: string[] } }).__hc037.gotos.push(String(url));
}
