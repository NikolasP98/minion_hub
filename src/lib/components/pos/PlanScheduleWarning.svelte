<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  type ScheduleIssue = 'invalid_rows' | 'principal_mismatch' | 'too_many_rows' | null;
  let { issue }: { issue: ScheduleIssue } = $props();
</script>

{#if issue}
  <span class="warning t-caption" role="alert">{m.pos_plan_schedule_invalid()}</span>
{/if}

<style>
  .warning {
    flex-basis: 100%;
    color: var(--color-warning-fg);
  }
</style>
