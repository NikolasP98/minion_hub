import { describe, expect, it } from 'vitest';
import { POS_TICKET_STATUSES, presentPosTicketStatus } from './ticket-status';

describe('POS ticket status presentation', () => {
  it('keeps the persisted status vocabulary canonical', () => {
    expect(POS_TICKET_STATUSES).toEqual(['submitted', 'void']);
  });

  it('presents submitted tickets as successful', () => {
    expect(presentPosTicketStatus('submitted')).toEqual({
      label: 'submitted',
      badgeValue: 'success',
    });
  });

  it('presents the persisted void status as user-facing voided', () => {
    expect(presentPosTicketStatus('void')).toEqual({
      label: 'voided',
      badgeValue: 'error',
    });
  });

  it('keeps legacy voided reads visibly voided', () => {
    expect(presentPosTicketStatus('voided')).toEqual({
      label: 'voided',
      badgeValue: 'error',
    });
  });
});
