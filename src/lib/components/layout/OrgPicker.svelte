<script lang="ts">
    import { invalidateAll } from "$app/navigation";
    import { page } from "$app/state";
    import { isAdmin } from "$lib/state/features/user.svelte";
    import { authClient } from "$lib/auth";
    import { Building2 } from "lucide-svelte";

    type OrgEntry = { id: string; name: string; slug: string | null; role: string };

    // Organizations + active org flow through (app)/+layout.server.ts into
    // page.data (keyed by the resolved active-org id, so it works across auth
    // modes despite the better-auth -> supabase identity divergence).
    const organizations = $derived<OrgEntry[]>(
        (page.data as { organizations?: OrgEntry[] })?.organizations ?? [],
    );
    const activeOrgId = $derived(
        (page.data as { activeOrgId?: string | null })?.activeOrgId ?? null,
    );

    const currentName = $derived(
        organizations.find((o) => o.id === activeOrgId)?.name ??
            organizations[0]?.name ??
            "Organization",
    );
    // Only admins with more than one org can switch; everyone else sees the name.
    const canSwitch = $derived(isAdmin.value && organizations.length > 1);

    let open = $state(false);

    async function select(orgId: string) {
        open = false;
        if (orgId === activeOrgId) return;
        try {
            await authClient.organization.setActive({ organizationId: orgId });
            await invalidateAll();
        } catch (err) {
            console.error("[org-picker] setActive failed", err);
        }
    }
</script>

<svelte:document onclick={() => (open = false)} />

{#if organizations.length > 0}
    <div class="relative w-full">
        <button
            type="button"
            class="relative w-full flex items-center gap-1.5 h-6 px-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium transition-colors whitespace-nowrap select-none text-muted-foreground {canSwitch
                ? 'cursor-pointer hover:text-foreground hover:bg-white/[0.04]'
                : 'cursor-default'}"
            onclick={(e) => {
                e.stopPropagation();
                if (canSwitch) open = !open;
            }}
            aria-haspopup={canSwitch ? "menu" : undefined}
            aria-label={currentName}
            title={currentName}
        >
            <Building2 size={12} class="shrink-0 opacity-70" />
            <span class="flex-1 overflow-hidden text-ellipsis text-left">{currentName}</span>
            {#if canSwitch}
                <span class="opacity-40 text-[9px] shrink-0">▾</span>
            {/if}
        </button>

        {#if open && canSwitch}
            <div
                class="absolute top-[calc(100%+4px)] left-0 z-50 bg-bg2 border border-border rounded-lg shadow-md min-w-[180px] max-w-[260px] overflow-hidden"
                role="menu"
                tabindex="0"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
            >
                {#each organizations as o (o.id)}
                    <div
                        class="flex items-center gap-2 py-[9px] px-[14px] cursor-pointer text-[13px] text-foreground transition-colors hover:bg-bg3"
                        role="menuitem"
                        tabindex="0"
                        onclick={() => select(o.id)}
                        onkeydown={(e) => e.key === "Enter" && select(o.id)}
                    >
                        <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{o.name}</span>
                        {#if o.id === activeOrgId}
                            <span class="text-accent text-[11px] shrink-0">✓</span>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/if}
