<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import TimeOffCalendar from '$lib/components/team/TimeOffCalendar.svelte';
  import type { TeamHoliday, TeamLeaveRequest } from '$lib/components/team/types';

  const people: Record<string, string> = { e1: 'Ana Quispe', e2: 'Luis Fernández de la Torre', e3: 'Mar' };
  const types: Record<string, string> = { 'lt-vac': 'Vacation', 'lt-sick': 'Sick leave', 'lt-unpaid': 'Unpaid leave' };

  const req = (
    id: string,
    employeeId: string,
    leaveTypeId: string,
    fromDate: string,
    toDate: string,
    status: TeamLeaveRequest['status'] = 'approved',
    halfDay = false,
  ): TeamLeaveRequest => ({
    id,
    employeeId,
    leaveTypeId,
    fromDate,
    toDate,
    halfDay,
    days: halfDay ? 0.5 : (Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000 + 1,
    reason: id === 'q3' ? 'Family trip — approved by HR on 2026-08-20, covers the long weekend.' : null,
    status,
    decidedBy: status === 'pending' ? null : 'u-admin',
    decidedAt: status === 'pending' ? null : '2026-08-20T15:00:00.000Z',
  });

  const requests: TeamLeaveRequest[] = [
    req('q1', 'e1', 'lt-vac', '2026-09-07', '2026-09-11'),
    req('q2', 'e2', 'lt-sick', '2026-09-09', '2026-09-09', 'approved', true),
    req('q3', 'e3', 'lt-vac', '2026-09-24', '2026-10-02', 'pending'),
    req('q4', 'e2', 'lt-unpaid', '2026-09-15', '2026-09-16', 'rejected'),
    req('q5', 'e1', 'lt-vac', '2026-09-28', '2026-09-28', 'cancelled'),
  ];
  const holidays: TeamHoliday[] = [
    { id: 'h1', date: '2026-10-08', name: 'Combate de Angamos', source: 'country', sourceKey: 'PE:2026-10-08', enabled: true },
    { id: 'h2', date: '2026-09-18', name: 'Company day (disabled)', source: 'manual', sourceKey: null, enabled: false },
    { id: 'h3', date: '2026-09-21', name: 'Clinic anniversary', source: 'manual', sourceKey: null, enabled: true },
  ];

  // The toolbar mirrors view/date into `?cal=&date=`; the mocked page URL
  // anchors the calendar on September 2026.
  const page = { url: new URL('http://localhost/team/time-off?date=2026-09-15&cal=month'), state: {} };

  const { Story } = defineMeta({
    title: 'Calendar/TimeOffCalendar',
    component: TimeOffCalendar,
    tags: ['autodocs'],
    parameters: { sveltekit_experimental: { state: { page } } },
    argTypes: { view: { control: 'select', options: ['month', 'week', 'agenda'] } },
    args: {
      requests,
      holidays,
      weeklyOff: [0, 6],
      employeeName: (id: string) => people[id] ?? id,
      typeName: (id: string) => types[id] ?? id,
      timeZone: 'America/Lima',
      view: 'month',
      onEventClick: fn(),
    },
  });
</script>

<Story name="Month" />
<Story name="Week" args={{ view: 'week' }} parameters={{ sveltekit_experimental: { state: { page: { ...page, url: new URL('http://localhost/team/time-off?date=2026-09-09&cal=week') } } } }} />
<Story name="Agenda" args={{ view: 'agenda' }} parameters={{ sveltekit_experimental: { state: { page: { ...page, url: new URL('http://localhost/team/time-off?date=2026-09-15&cal=agenda') } } } }} />
<Story name="Empty" args={{ requests: [], holidays: [] }} />
<Story name="No weekly off" args={{ weeklyOff: [] }} />
