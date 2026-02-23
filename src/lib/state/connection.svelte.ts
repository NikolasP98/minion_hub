export const conn = $state({
  connected: false,
  connecting: false,
  closed: true,
  connectedAt: null as number | null,
  backoffMs: 800,
  particleHue: 'red' as 'blue' | 'amber' | 'red',
  connectError: null as string | null,
});
