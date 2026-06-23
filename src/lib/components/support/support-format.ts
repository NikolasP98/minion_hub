// Client-safe presentation helpers for Support (no server imports).

export const STATUSES = ['open', 'replied', 'on_hold', 'resolved', 'closed'] as const;
export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

export const statusLabel: Record<string, string> = {
  open: 'Open',
  replied: 'Replied',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const priorityLabel: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** CSS color var per priority — drives the priority pill accent. */
export function priorityColor(p: string): string {
  switch (p) {
    case 'urgent':
      return 'var(--color-destructive, #ef4444)';
    case 'high':
      return '#f59e0b';
    case 'medium':
      return 'var(--color-accent)';
    default:
      return 'var(--color-muted-foreground)';
  }
}

export function slaColor(state: string): string {
  return state === 'failed'
    ? 'var(--color-destructive, #ef4444)'
    : state === 'fulfilled'
      ? '#22c55e'
      : 'var(--color-accent)';
}
