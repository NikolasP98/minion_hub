<script lang="ts">
    import * as m from "$lib/paraglide/messages";

    interface Props {
        activeCount: number;
        onclick: () => void;
    }

    let { activeCount, onclick }: Props = $props();
</script>

<button
    class="absolute top-3 right-3 z-40 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-bg2/90 backdrop-blur border border-border text-[10px] font-mono text-foreground hover:bg-accent/10 hover:border-accent/30 transition-all"
    {onclick}
>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
    >
        <path
            d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        ></path>
    </svg>
    {m.workshop_chats()}
    {#if activeCount > 0}
        <span
            class="flex items-center justify-center w-4 h-4 rounded-full bg-green-500/20 text-green-400 text-[9px]"
        >
            {activeCount}
        </span>
    {/if}
</button>
