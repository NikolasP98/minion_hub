<script lang="ts">
  import { preferenceOwner } from '$lib/state/ui/scoped-preference.svelte';
  import PersonalHome from '$lib/components/navigation/PersonalHome.svelte';
</script>

{#key preferenceOwner()}<PersonalHome />{/key}
