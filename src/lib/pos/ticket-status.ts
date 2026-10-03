export const POS_TICKET_STATUSES = ['submitted', 'void'] as const;

export type PosTicketStatus = (typeof POS_TICKET_STATUSES)[number];
export type ReadPosTicketStatus = PosTicketStatus | 'voided';

export interface PosTicketStatusPresentation {
  label: 'submitted' | 'voided';
  badgeValue: 'success' | 'error';
}

const PRESENTATION_BY_STATUS = {
  submitted: { label: 'submitted', badgeValue: 'success' },
  void: { label: 'voided', badgeValue: 'error' },
  voided: { label: 'voided', badgeValue: 'error' },
} as const satisfies Record<ReadPosTicketStatus, PosTicketStatusPresentation>;

/** Maps canonical values and legacy `voided` reads to their presentation state. */
export function presentPosTicketStatus(status: ReadPosTicketStatus): PosTicketStatusPresentation {
  return PRESENTATION_BY_STATUS[status];
}
