<script lang="ts">
  import * as zagSwitch from '@zag-js/switch';
  import { normalizeProps, useMachine } from '@zag-js/svelte';

  let {
    checked = false,
    onchange,
    id,
  }: {
    checked?: boolean;
    onchange?: (checked: boolean) => void;
    id?: string;
  } = $props();

  // @ts-expect-error — zag-js useMachine generics don't unify across machine types
  const service = useMachine(zagSwitch.machine, () => ({
    id: id ?? 'toggle',
    checked,
    onCheckedChange(details: zagSwitch.CheckedChangeDetails) {
      onchange?.(details.checked);
    },
  }));

  // @ts-expect-error — same type unification issue
  const api = $derived(zagSwitch.connect(service, normalizeProps));
</script>

<label {...api.getRootProps()} class="inline-flex items-center cursor-pointer">
  <input {...api.getHiddenInputProps()} />
  <span
    {...api.getControlProps()}
    class="relative inline-flex w-8 h-[18px] rounded-full border transition-colors shrink-0 overflow-hidden
      {api.checked ? 'bg-accent border-accent' : 'bg-bg3 border-border'}"
  >
    <span
      {...api.getThumbProps()}
      class="absolute top-[2px] left-[2px] w-3 h-3 rounded-full bg-white transition-transform shadow-sm
        {api.checked ? 'translate-x-[14px]' : 'translate-x-0'}"
    ></span>
  </span>
</label>
