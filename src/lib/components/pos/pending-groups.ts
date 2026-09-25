/**
 * Group unscheduled tray lines by customer so a client with many pending
 * procedures collapses to one row instead of flooding the tray. Anonymous
 * lines (no party, no CRM contact, no name) never merge with each other —
 * each stays its own single-line group, keyed by its own line id.
 */
export interface PendingGroupLine {
  lineId: string;
  partyId: string | null;
  crmContactId: string | null;
  customerName: string | null;
}

export interface PendingGroup<T extends PendingGroupLine> {
  key: string;
  customerName: string | null;
  lines: T[];
}

export function groupPendingLines<T extends PendingGroupLine>(lines: T[]): PendingGroup<T>[] {
  const groups: PendingGroup<T>[] = [];
  const byKey = new Map<string, PendingGroup<T>>();
  for (const line of lines) {
    const key = line.partyId ?? line.crmContactId ?? line.customerName ?? line.lineId;
    let group = byKey.get(key);
    if (!group) {
      group = { key, customerName: line.customerName, lines: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.lines.push(line);
  }
  return groups;
}
