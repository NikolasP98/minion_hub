<script lang="ts">
    import { invalidateAll } from "$app/navigation";
    import { page } from "$app/state";
    import { conn } from "$lib/state/gateway";
    import { wsConnect, wsDisconnect } from "$lib/services/gateway.svelte";
    import { applyOrgAssignedHost } from "$lib/state/features/hosts.svelte";
    import { isAdmin } from "$lib/state/features/user.svelte";
    import { toastSuccess, toastError } from "$lib/state/ui/toast.svelte";
    import { Building2, User, Loader2, Check } from "lucide-svelte";
    import { Button, iconSizes } from '$lib/components/ui';
    import type { OrgKind } from "$lib/org-kind";

    type OrgEntry = { id: string; name: string; slug: string | null; role: string; kind?: OrgKind };

    // Organizations + active org flow through (app)/+layout.server.ts into
    // page.data (keyed by the resolved active-org id, so it works across auth
    // modes despite the better-auth -> supabase identity divergence).
    const organizations = $derived<OrgEntry[]>(
        (page.data as { organizations?: OrgEntry[] })?.organizations ?? [],
    );
    const activeOrgId = $derived(
        (page.data as { activeOrgId?: string | null })?.activeOrgId ?? null,
    );

    const activeOrg = $derived(
        organizations.find((o) => o.id === activeOrgId) ?? organizations[0],
    );
    const currentName = $derived(activeOrg?.name ?? "Organization");
    const activeKind = $derived<OrgKind>(activeOrg?.kind ?? "business");
    // Only admins with more than one org can switch; everyone else sees the name.
    const canSwitch = $derived(isAdmin.value && organizations.length > 1);
    // Business orgs first, then personal; stable secondary sort by name — the
    // two classes read as distinct blocks (cosmetic with few orgs, pays off as
    // the list grows).
    const sortedOrganizations = $derived(
        [...organizations].sort((a, b) => {
            const ak = a.kind ?? "business";
            const bk = b.kind ?? "business";
            if (ak !== bk) return ak === "business" ? -1 : 1;
            return a.name.localeCompare(b.name);
        }),
    );

    let open = $state(false);
    // The org id currently being switched to (non-null = a switch is in flight).
    // Drives the inline spinner + disables further clicks until it settles.
    let switchingTo = $state<string | null>(null);

    async function select(orgId: string) {
        open = false;
        if (orgId === activeOrgId || switchingTo) return;
        const target = organizations.find((o) => o.id === orgId);
        switchingTo = orgId;
        try {
            // Supabase mode: persist via the active_org cookie (resolveIdentity
            // honors it). This is the switch that actually takes effect on cloud.
            const res = await fetch("/api/active-org", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ orgId }),
            });
            if (!res.ok) throw new Error(`active-org ${res.status}`);
            // Re-runs every load fn so layout data (active org, permissions, …)
            // reflects the new org. Pages that fetch client-side react to the
            // changed activeOrgId in page.data.
            await invalidateAll();
            // Re-point at the new org's assigned gateway (fresh page.data) —
            // beats any stale manual pick from the previous org context.
            const hostChanged = applyOrgAssignedHost();
            // The gateway JWT is minted once at WS connect (onChallenge) from the
            // active_org cookie, and the gateway org-scopes channels.status by that
            // claim. invalidateAll() refreshes server-loaded data but NOT the live
            // socket — so reconnect to re-handshake with the new org's JWT, else
            // gw.channels keeps the previous org's accounts. Cookie is already set
            // above, so the reconnect picks up the new org. Reconnect exactly once
            // per user-initiated switch (also when the assigned host changed).
            if (conn.connected || hostChanged) {
                wsDisconnect();
                void wsConnect();
            }
            toastSuccess(`Switched to ${target?.name ?? "organization"}`);
        } catch (err) {
            console.error("[org-picker] switch failed", err);
            toastError(
                "Couldn't switch organization",
                err instanceof Error ? err.message : undefined,
            );
        } finally {
            switchingTo = null;
        }
    }
</script>

<svelte:document onclick={() => (open = false)} />

{#if organizations.length > 0}
    <div class="relative w-full">
        <Button variant="ghost" size="xs"
            type="button"
            disabled={!!switchingTo}
            class="relative w-full flex items-center gap-1.5 h-6 px-1.5 rounded-[var(--radius-sm)] text-[length:var(--font-size-label)] font-medium transition-colors whitespace-nowrap select-none text-muted-foreground {canSwitch && !switchingTo
                ? 'cursor-pointer hover:text-foreground hover:bg-bg3'
                : 'cursor-default'} {switchingTo ? 'opacity-70' : ''}"
            onclick={(e) => {
                e.stopPropagation();
                if (canSwitch && !switchingTo) open = !open;
            }}
            aria-haspopup={canSwitch ? "menu" : undefined}
            aria-busy={!!switchingTo}
            aria-label={currentName}
            title={switchingTo ? "Switching organization…" : currentName}
        >
            {#if switchingTo}
                <Loader2 size={iconSizes.xs} class="shrink-0 animate-spin opacity-80" />
            {:else if activeKind === "personal"}
                <User size={iconSizes.xs} class="shrink-0 opacity-70" role="img" aria-label="Personal" />
            {:else}
                <Building2 size={iconSizes.xs} class="shrink-0 opacity-70" role="img" aria-label="Business" />
            {/if}
            <span class="flex-1 overflow-hidden text-ellipsis text-left">{currentName}</span>
            {#if canSwitch && !switchingTo}
                <span class="opacity-40 text-[length:var(--font-size-telemetry)] shrink-0">▾</span>
            {/if}
        </Button>

        {#if open && canSwitch}
            <div
                class="absolute top-[calc(100%+4px)] left-0 z-[var(--layer-modal)] bg-bg2 border border-border rounded-lg shadow-md min-w-[180px] max-w-[260px] overflow-hidden"
                role="menu"
                tabindex="0"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
            >
                {#each sortedOrganizations as o (o.id)}
                    <div
                        class="!h-auto flex items-center gap-2 py-[var(--space-2)] px-[var(--space-4)] cursor-pointer text-[length:var(--font-size-body)] text-foreground transition-colors hover:bg-bg3 [&>span]:w-full [&>span]:justify-start {switchingTo
                            ? 'pointer-events-none opacity-60'
                            : ''}"
                        role="menuitem"
                        tabindex="0"
                        onclick={() => select(o.id)}
                        onkeydown={(e) => e.key === "Enter" && select(o.id)}
                    >
                        <!-- Kind is conveyed by the icon alone (user directive 2026-07-19);
                             the icon is therefore labelled, not decorative, so it still
                             reaches screen readers. -->
                        {#if (o.kind ?? "business") === "personal"}
                            <User size={iconSizes.xs} class="shrink-0 opacity-70" role="img" aria-label="Personal" />
                        {:else}
                            <Building2 size={iconSizes.xs} class="shrink-0 opacity-70" role="img" aria-label="Business" />
                        {/if}
                        <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{o.name}</span>
                        {#if switchingTo === o.id}
                            <Loader2 size={iconSizes.xs} class="text-accent shrink-0 animate-spin" />
                        {:else if o.id === activeOrgId}
                            <Check size={iconSizes.xs} class="text-accent shrink-0" />
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/if}
