export const page = $state({
  url: new URL('http://fixture.invalid/settings/notifications'),
  data: {
    user: { role: 'user' },
    permissions: { permissions: ['comms:manage'] },
    activeOrgKind: 'business',
  },
});
