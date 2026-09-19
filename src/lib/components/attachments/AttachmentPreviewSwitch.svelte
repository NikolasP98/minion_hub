<script lang="ts">
  import { SegmentedControl } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { attachmentPreview, setAttachmentPreview } from '$lib/attachments/preview-mode.svelte';
</script>

<SegmentedControl
  items={[
    { value: 'off', label: m.attachments_view_list() },
    { value: 'hover', label: m.attachments_view_hover() },
    { value: 'card', label: m.attachments_view_cards() },
  ]}
  value={attachmentPreview.mode}
  onValueChange={setAttachmentPreview}
  aria-label={m.attachments_view_aria()}
/>
