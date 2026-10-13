<script lang="ts">
  /**
   * The `/pos/appointments` staff-filter → preference mirror, reduced to the
   * two moving parts: the REAL `createCalendarPrefs` and an `$effect` that
   * pushes a filter value into it. Mounting is the point — `calendar-prefs`'s
   * own unit test runs under the node env where `$effect`s never execute, so
   * an "is this setter safe inside an effect?" regression can only be caught
   * with a real component instance.
   */
  import { createCalendarPrefs } from '../calendar-prefs.svelte';

  let {
    selection,
  }: {
    /** The staff ids the filter currently carries. */
    selection: string[];
  } = $props();

  const prefs = createCalendarPrefs('pos');

  $effect(() => {
    prefs.setStaff(selection);
  });
</script>

<p data-testid="staff">{prefs.staff.join(',')}</p>
