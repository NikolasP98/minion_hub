<script lang="ts">
    import type { Snippet } from 'svelte';
    import SettingsNav from '$lib/components/settings/SettingsNav.svelte';
    import { page } from '$app/state';
    import { goto } from '$app/navigation';

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

<div class="flex-1 min-h-0 flex">
    <SettingsNav onselect={handleSelect} />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {@render children()}
    </div>
</div>
