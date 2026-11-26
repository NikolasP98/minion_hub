<script lang="ts">
  import Chip from './Chip.svelte';
  import Skeleton from './Skeleton.svelte';
  import TagChip from '$lib/components/tags/TagChip.svelte';
</script>

<Chip onRemove={() => {}}>Paid</Chip>
<Chip onRemove={() => {}}>Draft</Chip>
<TagChip name="VIP" onremove={() => {}} />
<Skeleton />
<Skeleton label="Loading customers" />
