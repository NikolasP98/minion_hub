<script lang="ts">
  import { iconSizes, Button } from '$lib/components/ui';
  import { Sparkles } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    loading: boolean;
    onclick: () => void;
    title?: string;
  }

  let { loading, onclick, title }: Props = $props();
</script>

<!-- .ai-wand-btn styles live in the parent (ChapterEditor.svelte) so the
     `.field:hover .ai-wand-btn` parent-selector keeps working. -->
<Button
  variant="ghost"
  class={`ai-wand-btn${loading ? ' loading' : ''}`}
  {onclick}
  {loading}
  title={title ?? m.builder_aiFillField()}
>
  <Sparkles size={iconSizes.xs} />
</Button>
