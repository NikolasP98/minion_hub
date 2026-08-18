/**
 * The one classification fixture shared by `crm-deposit-rule.test.ts` (pure
 * `isDepositText` checks) and `crm-deposit-rule.sql.integration.test.ts`
 * (the same cases evaluated by real PostgreSQL ILIKE) — so the TS-side and
 * DB-side decision paths are asserted against the exact same inputs and can
 * never silently diverge.
 */
export const DEPOSIT_TEXT_CASES: Array<[string, boolean]> = [
  ['Reserva de Consulta', true], // display casing
  ['RESERVA', true], // upper case
  ['reserva', true], // exact
  ['una reserva por cita', true], // substring-in-sentence
  ['prereserva', true], // substring-in-word
  ['reservó', false], // accents-as-typed: no accent folding, é != a
  ['adelanto', false], // different word entirely
  ['', false], // empty string
];
