/** Exact mandatory inventory: no dynamic omissions or selected-case qualification. */
export const PULSE_CRITICAL_TITLES = ['en', 'es'].flatMap((locale) => [
  ...['approve', 'dismiss'].flatMap((action) => [
    `PULSE1 ${locale} notifications ${action} submits the rendered revision, conflicts, then refreshes before retry`,
    `PULSE2 ${locale} notifications ${action} retains committed receipt after failed invalidation and reconnects without replay`,
  ]),
  `PULSE4 ${locale} notifications recovers an unknown committed transport using reads only`,
  `PULSE6 ${locale} notifications hides other-owner content and rejects receipt readback`,
  `PULSE5 ${locale} page retains the editable draft after known save rejection`,
  ...['page', 'popup'].map(
    (surface) =>
      `PULSE3 ${locale} ${surface} uses real approval controls and reads scheduled receipt on reconnect`,
  ),
]);
