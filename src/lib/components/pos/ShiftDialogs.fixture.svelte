<script lang="ts">
  // The POS layout's shape: one context, the banner (twice-rendered rail) and ONE dialogs host.
  import ShiftBanner from './ShiftBanner.svelte';
  import ShiftDialogs from './ShiftDialogs.svelte';
  import { setShiftDialogs } from './shift-dialogs-context';

  setShiftDialogs();
</script>

<ShiftBanner />
<ShiftDialogs />
