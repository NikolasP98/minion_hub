<script lang="ts">
  // Stand-in for PartyPicker in mounted page tests: one button sets a fixed party.
  let {
    value = $bindable(null),
    label = '',
    onPicked,
  }: { value?: string | null; label?: string; onPicked?: () => void } = $props();
  export function pick() {}
</script>

<span>{label}</span>
<button
  type="button"
  onclick={() => {
    value = 'party-1';
    onPicked?.();
  }}>set party</button
>
