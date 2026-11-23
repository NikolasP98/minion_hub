import { Ban, Check, CheckCheck, Circle, Clock, UserX, X } from 'lucide-svelte';
import * as m from '$lib/paraglide/messages';

/** Status id → the icon a block's status line shows (colour is never the only cue). */
export const STATUS_ICONS = {
  accepted: Check,
  pending: Clock,
  completed: CheckCheck,
  rejected: X,
  no_show: UserX,
  cancelled: Ban,
} as const;

export const statusIcon = (status: string) =>
  (STATUS_ICONS as Record<string, typeof Circle>)[status] ?? Circle;

/**
 * What a block adds for screen readers after its visible text (time, service, client): the day,
 * the full time range and the status. It is rendered as hidden text INSIDE the block rather
 * than as an `aria-label`, so the spoken name always contains the visible words (WCAG 2.5.3).
 * All parts arrive already localised.
 */
export function blockDetail(p: {
  day: string;
  start: string;
  end: string;
  status: string;
}): string {
  return m.sched_block_detail(p);
}
