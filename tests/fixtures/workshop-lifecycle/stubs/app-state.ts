/** Mutable `$app/state` twin: the driver rotates actor/org through `window.__hc037.page.data`. */
export const page = {
  data: {
    user: { id: 'actor-1', email: 'fixture@example.invalid', role: 'user' },
    activeOrgId: 'org-1',
  } as Record<string, unknown>,
  params: {} as Record<string, string>,
  url: new URL('http://fixture.invalid/'),
  route: { id: null as string | null },
  status: 200,
  error: null,
  form: null,
  state: {},
};
export const navigating = { from: null, to: null, type: null, complete: Promise.resolve() };
export const updated = { current: false, check: async () => false };
