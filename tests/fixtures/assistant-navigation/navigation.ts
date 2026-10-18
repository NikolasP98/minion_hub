export const navigations: string[] = [];
export async function goto(href: string) {
  navigations.push(href);
  history.pushState({}, '', href);
}
export * from '../../../src/server/test-utils/env-stubs/app-navigation';
