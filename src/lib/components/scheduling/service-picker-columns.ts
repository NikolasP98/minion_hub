/**
 * The `Picker` columns for choosing an event type/service — shared by
 * `AppointmentForm`'s service picker and `BookingDetailDrawer`'s "Add service"
 * so the two copies cannot drift (owner ask 2026-10-07).
 *
 * A function, not a module-scope constant: a top-level `m.*()` call bakes the
 * locale active at first import (SSR) into every later request — see
 * AGENTS.md "module-scope m.x() SSR-BAKES 'en'". Call it inside a component's
 * instance script (or inline in markup) so it re-reads the live locale.
 */
import * as m from '$lib/paraglide/messages';
import type { PickerColumn } from '$lib/components/ui';

export function serviceColumns<T extends { title: string; length?: number }>(): PickerColumn<T>[] {
  return [
    {
      key: 'title',
      label: m.sched_booking_service(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'length',
      label: m.sched_et_length(),
      value: (e) => (e.length ? `${e.length} min` : ''),
      align: 'right',
      priority: 20,
    },
  ];
}
