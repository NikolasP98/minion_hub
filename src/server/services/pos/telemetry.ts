import * as Sentry from '@sentry/sveltekit';
import { PosError } from './errors';

/** A rejected stored balance is an operational defect, not ordinary bad cashier input. */
export function reportStoredMoneyFailure(error: unknown): void {
  if (!(error instanceof PosError) || error.code !== 'invalid_stored_amount') return;
  try {
    // Never send the original exception, field value, customer identifiers or metadata.
    Sentry.captureException(new Error('POS stored monetary data failed validation'), {
      tags: { area: 'pos', code: 'invalid_stored_amount' },
      fingerprint: ['pos', 'invalid_stored_amount'],
    });
  } catch {
    // An unavailable observer must not replace the financial error response.
  }
}
