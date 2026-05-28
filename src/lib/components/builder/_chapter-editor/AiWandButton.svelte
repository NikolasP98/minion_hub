<script lang="ts">
    import { Sparkles, Loader2 } from "lucide-svelte";
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
<button
    class="ai-wand-btn"
    class:loading
    {onclick}
    disabled={loading}
    title={title ?? m.builder_aiFillField()}
>
    {#if loading}<Loader2 size={12} class="spin" />{:else}<Sparkles size={12} />{/if}
</button>
