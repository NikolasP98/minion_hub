<script lang="ts">
  import { Badge } from '$lib/components/ui';
  import type { PulseReceipt } from '$server/services/pulse-dispatch.store';
  import * as m from '$lib/paraglide/messages';
  let { receipt }: { receipt: PulseReceipt } = $props();
  const label = $derived(
    receipt.dispatch?.state === 'scheduled'
      ? m.pulse_scheduled()
      : receipt.dispatch?.state === 'queued'
        ? m.pulse_queued()
        : receipt.dispatch?.state === 'admitted'
          ? m.pulse_admitted()
          : receipt.dispatch?.state === 'indeterminate'
            ? m.pulse_indeterminate()
            : receipt.dispatch?.state === 'legacy_unverified'
              ? m.pulse_legacyUnverified()
              : receipt.dispatch?.state === 'rejected'
                ? m.pulse_rejected()
                : receipt.dispatch?.state === 'canceled'
                  ? m.pulse_canceled()
                  : receipt.decision === 'dismissed'
                    ? m.pulse_dismissed()
                    : m.pulse_approved(),
  );
  const reason = $derived(
    !receipt.dispatch?.reason
      ? null
      : receipt.dispatch.reason === 'authority_unavailable'
        ? m.pulse_reasonAuthority()
        : receipt.dispatch.reason === 'qualification_unavailable'
          ? m.pulse_reasonQualification()
          : receipt.dispatch.reason === 'payload_unavailable'
            ? m.pulse_reasonPayload()
            : receipt.dispatch.reason === 'pre_admission_unavailable'
              ? m.pulse_reasonPreAdmission()
              : [
                    'remote_acceptance_unknown',
                    'admission_reclaimed',
                    'authority_revoked_after_admission',
                  ].includes(receipt.dispatch.reason)
                ? m.pulse_reasonUnknown()
                : ['authority_revoked', 'worker_disabled'].includes(receipt.dispatch.reason)
                  ? m.pulse_reasonCanceled()
                  : m.pulse_reasonUnavailable(),
  );
</script>

<div class="receipt" role="status" data-pulse-receipt={receipt.proposalId}>
  <Badge variant="neutral" size="sm">{label}</Badge>
  <span class="t-caption">{m.pulse_revision({ revision: receipt.revision })}</span>
  {#if reason}<span class="t-caption">{reason}</span>{/if}
  {#if receipt.receiptId}<span class="t-mono">{receipt.receiptId}</span>{/if}
  {#if receipt.dispatch?.remoteJobId}<span class="t-caption"
      >{m.pulse_remoteJob({ id: receipt.dispatch.remoteJobId })}</span
    >{/if}
</div>

<style>
  .receipt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    overflow-wrap: anywhere;
  }
</style>
