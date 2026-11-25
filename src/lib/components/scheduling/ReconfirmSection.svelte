<script lang="ts">
  /**
   * Spec 139: the reminder follow-up of one appointment. Shown in the booking drawer when a client
   * answered "no" to a reminder: what the agent did, what staff should do next, and the actions.
   * Nothing here cancels or refunds on its own: Reagendar and Cancelar cita hand over to the drawer's
   * own flows, and "Atendido" only closes the follow-up.
   */
  import { Calendar, Check, MessageCircle, Phone, X } from 'lucide-svelte';
  import { Badge, Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  /** The serialized `ReconfirmCaseView` (dates arrive as ISO strings). */
  export type ReconfirmCase = {
    id: string;
    open: boolean;
    agentState: string;
    result: string | null;
    closeAction: string | null;
    contactId: string | null;
    masked: boolean;
    events: Array<{ kind: string; content: string | null; createdAt: string }>;
  };

  type Props = {
    reconfirm: ReconfirmCase;
    /** Unmasked client phone for "Llamar"; null hides the action. */
    phone: string | null;
    /** The appointment's current start, already formatted (for "Reprogramada … para el {when}"). */
    startLabel: string;
    /** Formats an ISO instant in the organization's timezone. */
    fmt: (iso: string) => string;
    /** The booking is still pending/accepted, so rescheduling and cancelling make sense. */
    live: boolean;
    canEdit: boolean;
    canManage: boolean;
    onreschedule: () => void;
    oncancel: () => void;
    /** The follow-up was closed; the host re-reads the appointment. */
    onclosed: () => void | Promise<void>;
  };
  let {
    reconfirm,
    phone,
    startLabel,
    fmt,
    live,
    canEdit,
    canManage,
    onreschedule,
    oncancel,
    onclosed,
  }: Props = $props();

  const phase = $derived(
    !reconfirm.open
      ? 'closed'
      : reconfirm.result === null &&
          (reconfirm.agentState === 'asking' || reconfirm.agentState === 'offered')
        ? 'agent'
        : 'staff',
  );
  const result = $derived(reconfirm.result);

  const TAGS: Record<string, () => string> = {
    declined: () => m.sched_reconfirm_tag_declined(),
    wants_other_date: () => m.sched_reconfirm_tag_wants_other_date(),
    no_answer: () => m.sched_reconfirm_tag_no_answer(),
    unclear: () => m.sched_reconfirm_tag_unclear(),
    late_reply: () => m.sched_reconfirm_tag_late_reply(),
    send_failed: () => m.sched_reconfirm_tag_send_failed(),
    staff_handling: () => m.sched_reconfirm_tag_staff_handling(),
  };
  const tag = $derived(
    phase === 'agent'
      ? m.sched_reconfirm_tag_agent()
      : phase === 'closed'
        ? m.sched_reconfirm_tag_closed()
        : ((result && TAGS[result]?.()) ?? m.sched_reconfirm_tag_none()),
  );
  const tone = $derived(
    phase === 'agent'
      ? 'info'
      : phase === 'closed'
        ? 'success'
        : result === 'no_answer' || result === 'send_failed'
          ? 'error'
          : 'warning',
  );

  const TEXTS: Record<string, () => string> = {
    declined: () => m.sched_reconfirm_text_declined(),
    wants_other_date: () => m.sched_reconfirm_text_wants_other_date(),
    no_answer: () => m.sched_reconfirm_text_no_answer(),
    unclear: () => m.sched_reconfirm_text_unclear(),
    late_reply: () => m.sched_reconfirm_text_late_reply(),
    send_failed: () => m.sched_reconfirm_text_send_failed(),
    staff_handling: () => m.sched_reconfirm_text_staff_handling(),
  };
  const text = $derived.by(() => {
    if (phase === 'agent') return m.sched_reconfirm_text_agent();
    if (phase === 'closed') {
      if (result === 'rescheduled') return m.sched_reconfirm_text_rescheduled({ when: startLabel });
      if (result === 'will_come') return m.sched_reconfirm_text_will_come();
      if (reconfirm.closeAction === 'booking_closed') return m.sched_reconfirm_text_booking_closed();
      if (reconfirm.closeAction === 'moved_by_staff') return m.sched_reconfirm_text_moved();
      return m.sched_reconfirm_text_attended();
    }
    return (result && TEXTS[result]?.()) ?? m.sched_reconfirm_text_none();
  });

  /** What the client last wrote (classified), unless the viewer may not read message text. */
  const quote = $derived.by(() => {
    if (phase === 'closed' || reconfirm.masked) return null;
    if (result === 'no_answer' || result === 'send_failed' || result === 'staff_handling')
      return null;
    const last = [...reconfirm.events].reverse().find((e) => e.kind === 'verdict' && e.content);
    if (!last?.content) return null;
    const line = last.content.split('\n').filter(Boolean).pop() ?? '';
    const clipped = line.length > 120 ? `${line.slice(0, 117)}…` : line;
    return m.sched_reconfirm_quote({ text: clipped, when: fmt(last.createdAt) });
  });

  /** Clients who did not answer need a call, not a new date: the preview shows only Llamar + Atendido. */
  const needsCallOnly = $derived(result === 'no_answer' || result === 'send_failed');
  const showEditActions = $derived(phase === 'staff' && live && canEdit && !needsCallOnly);
  const showConversation = $derived(
    !!reconfirm.contactId &&
      (phase !== 'staff' ||
        result === null ||
        result === 'unclear' ||
        result === 'staff_handling' ||
        result === 'send_failed'),
  );

  let busy = $state(false);
  let err = $state<string | null>(null);
  async function markAttended() {
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/scheduling/reconfirmations/${reconfirm.id}/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        err =
          res.status === 403
            ? m.sched_reconfirm_err_forbidden()
            : res.status === 404
              ? m.sched_reconfirm_err_not_found()
              : m.sched_reconfirm_err_generic();
        return;
      }
      await onclosed();
    } catch {
      err = m.sched_reconfirm_err_generic();
    } finally {
      busy = false;
    }
  }
</script>

<section class="blk" aria-labelledby="reconfirm-title-{reconfirm.id}">
  <h4 class="t-label" id="reconfirm-title-{reconfirm.id}">{m.sched_reconfirm_title()}</h4>
  <div class="case" data-phase={phase}>
    <div class="head">
      <Badge variant="semantic" value={tone} size="sm">{tag}</Badge>
    </div>
    <p class="t-body">
      {text}{#if quote}{' '}{quote}{/if}
    </p>
    {#if err}<p class="t-caption danger" role="alert">{err}</p>{/if}
    {#if showEditActions || (phase === 'staff' && (phone || canManage)) || showConversation}
      <div class="actions">
        {#if showEditActions}
          <Button size="sm" variant="outline" onclick={onreschedule}>
            <Calendar size={iconSizes.sm} />{m.sched_reconfirm_reschedule()}
          </Button>
          <Button size="sm" variant="outline" onclick={oncancel}>
            <X size={iconSizes.sm} />{m.sched_reconfirm_cancel()}
          </Button>
        {/if}
        {#if phase === 'staff' && phone}
          <Button size="sm" variant="outline" href={`tel:${phone}`}>
            <Phone size={iconSizes.sm} />{m.sched_reconfirm_call()}
          </Button>
        {/if}
        {#if showConversation}
          <Button size="sm" variant="ghost" href={`/crm/${reconfirm.contactId}`}>
            <MessageCircle size={iconSizes.sm} />{m.sched_reconfirm_conversation()}
          </Button>
        {/if}
        {#if phase === 'staff' && canManage}
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            disabled={busy}
            aria-label={m.sched_reconfirm_attended_label()}
            onclick={markAttended}
          >
            <Check size={iconSizes.sm} />{m.sched_reconfirm_attended()}
          </Button>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .blk {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .case {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-card-compact);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .danger {
    color: var(--color-danger-fg);
  }
</style>
