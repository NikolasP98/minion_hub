<script lang="ts">
    import type { Snippet } from 'svelte';
    import SettingsNav from '$lib/components/settings/SettingsNav.svelte';
    import { page } from '$app/state';
    import { goto } from '$app/navigation';
    import { SectionShell } from '$lib/components/ui/foundations';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();

    // Gateway-tab selection is only meaningful when we're on /settings (legacy host page).
    // For hub-tab routes (/settings/team, /settings/backups, …) clicking a gateway tab
    // navigates to /settings?s=<id>.
    function handleSelect(id: string) {
        const target = `/settings?s=${id}`;
        if (page.url.pathname === '/settings') {
            goto(target, { replaceState: true, noScroll: true });
        } else {
            goto(target);
        }
    }
</script>

<SectionShell mode="responsive">
    {#snippet navigation()}<SettingsNav onselect={handleSelect} />{/snippet}
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {@render children()}
    </div>
</SectionShell>
