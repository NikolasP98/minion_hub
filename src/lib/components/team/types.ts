/** Serialised shapes the /team loader hands to the HR tabs. */
export interface TeamEmployee {
  id: string;
  profileId: string | null;
  resourceId: string | null;
  name: string;
  email: string | null;
  designation: string | null;
  department: string | null;
  employmentType: string | null;
  status: 'active' | 'left';
  joinedOn: string | null;
  leftOn: string | null;
  color: string | null;
}

export interface TeamMember {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  accountType: string;
  /** RBAC roles in the active org — only populated for users.manage holders. */
  memberRoles: string[];
}

export interface TeamRbacRole {
  key: string;
  name: string;
  rank: number;
  description: string | null;
}

export interface TeamOrganization {
  id: string;
  name: string;
}

export interface TeamLeaveType {
  id: string;
  code: string;
  name: string;
  paid: boolean;
}

export interface TeamAllocation {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  periodStart: string;
  periodEnd: string;
  days: number;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface TeamLeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface TeamHoliday {
  id: string;
  date: string;
  name: string;
  /** 'manual' | 'country' — imported rows are toggled/moved, never retyped. */
  source: string;
  /** `${country}:${originalDate}` for imports (the original date survives a move). */
  sourceKey: string | null;
  enabled: boolean;
}

export interface TeamHrSettings {
  /** Recurring weekly off, 0=Sun…6=Sat. */
  weeklyOff: number[];
  country: string | null;
}

/** Non-staff `sched_resources` (rooms / equipment) — never linked to an employee. */
export interface TeamResource {
  id: string;
  name: string;
  kind: 'room' | 'equipment';
  color: string | null;
  active: boolean;
}

export interface TeamBooking {
  id: string;
  resourceId: string;
  eventTypeId: string;
  start: string;
  end: string;
  status: string;
  attendeeName: string | null;
}

/** Local 'YYYY-MM-DD' for today (the loader's week window is local too). */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const JSON_HEADERS = { 'content-type': 'application/json' } as const;
