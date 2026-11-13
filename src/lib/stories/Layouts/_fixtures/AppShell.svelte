<script lang="ts">
  // The `(app)/+layout.svelte` markup without its live-data effects (hosts,
  // permissions, plugin nav, notifications): Sidebar + Topbar + one scroll owner.
  import type { Snippet } from 'svelte';
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from '$lib/query/client';
  import Sidebar from '$lib/components/layout/Sidebar.svelte';
  import Topbar from '$lib/components/layout/Topbar.svelte';
  import { AppViewport } from '$lib/components/ui/foundations';

  let { children }: { children: Snippet } = $props();
</script>

<QueryClientProvider client={queryClient}>
  <div class="layout-frame">
    <AppViewport class="hub-shell-viewport">
      <div
        data-part="primary-shell"
        class="relative flex flex-1 min-w-0 min-h-0 overflow-clip text-foreground"
      >
        <Sidebar />
        <div class="shell-main flex flex-col flex-1 min-w-0 min-h-0 overflow-clip">
          <Topbar />
          <div data-part="route-viewport" class="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div class="h-full min-h-0 flex flex-col">
              {@render children()}
            </div>
          </div>
        </div>
      </div>
    </AppViewport>
  </div>
</QueryClientProvider>

<style>
  /* The shell fills the story canvas exactly like the app viewport (no fixed
     positioning: the body must keep the shell's height for DOM capture). */
  .layout-frame {
    display: flex;
    height: 100vh;
    height: 100dvh;
    background: var(--color-canvas);
  }
</style>
