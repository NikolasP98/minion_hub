# Topbar Icons & Profile Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the Topbar with Lucide icons on all nav tabs, move host-specific tabs left, and add a profile avatar dropdown with user info and logout.

**Architecture:** Install `lucide-svelte`, create a `user.svelte.ts` state module (fetches `/api/auth/me` on mount), create a `ProfileMenu.svelte` dropdown component, and rewrite `Topbar.svelte` with the new three-zone layout.

**Tech Stack:** SvelteKit, Svelte 5 runes, lucide-svelte, Tailwind CSS

---

### Task 1: Install lucide-svelte

**Files:**
- Modify: `package.json`

**Step 1: Install the package**

```bash
bun add lucide-svelte
```

**Step 2: Verify it resolves**

```bash
bun run check 2>&1 | head -20
```
Expected: no new errors (type-check may show unrelated warnings that existed before)

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "feat: add lucide-svelte"
```

---

### Task 2: Create user state module

**Files:**
- Create: `src/lib/state/user.svelte.ts`

**Step 1: Write the module**

```typescript
// src/lib/state/user.svelte.ts
import { goto } from '$app/navigation';

interface CurrentUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface UserState {
  user: CurrentUser | null;
  role: string | null;
  tenantId: string | null;
  loading: boolean;
}

const state = $state<UserState>({
  user: null,
  role: null,
  tenantId: null,
  loading: false,
});

export const userState = state;

export async function loadUser() {
  state.loading = true;
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      state.user = data.user;
      state.role = data.role;
      state.tenantId = data.tenantId;
    }
  } finally {
    state.loading = false;
  }
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  state.user = null;
  state.role = null;
  state.tenantId = null;
  goto('/login');
}

export function getUserInitials(user: CurrentUser): string {
  if (user.displayName) {
    return user.displayName
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return user.email.slice(0, 2).toUpperCase();
}
```

**Step 2: Type-check**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```
Expected: no new errors

**Step 3: Commit**

```bash
git add src/lib/state/user.svelte.ts
git commit -m "feat: add user state module with loadUser and logout"
```

---

### Task 3: Call loadUser from layout

**Files:**
- Modify: `src/routes/+layout.svelte`

**Step 1: Add loadUser to the existing onMount**

The layout already has an `onMount`. Import `loadUser` and call it alongside `loadHosts()`.

```svelte
<script lang="ts">
  // ... existing imports ...
  import { loadUser } from '$lib/state/user.svelte';

  // ...

  onMount(async () => {
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
    loadUser(); // fire-and-forget, don't await
  });
</script>
```

**Step 2: Check no regressions**

```bash
bun run check 2>&1 | grep -E "error|Error" | head -20
```

**Step 3: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat: load current user on app mount"
```

---

### Task 4: Create ProfileMenu component

**Files:**
- Create: `src/lib/components/ProfileMenu.svelte`

**Step 1: Write the component**

```svelte
<script lang="ts">
  import { userState, logout, getUserInitials } from '$lib/state/user.svelte';
  import { LogOut, Settings, User } from 'lucide-svelte';

  let open = $state(false);

  function toggle() {
    open = !open;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }

  const initials = $derived(
    userState.user ? getUserInitials(userState.user) : '?'
  );

  const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
  const email = $derived(userState.user?.email ?? '');
  const role = $derived(userState.role ?? '');
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="relative">
  <button
    onclick={toggle}
    class="w-7 h-7 rounded-full bg-accent/20 border border-accent/30 text-accent text-[11px] font-bold flex items-center justify-center hover:bg-accent/30 transition-colors duration-150 select-none"
    aria-label="Profile menu"
    aria-expanded={open}
  >
    {initials}
  </button>

  {#if open}
    <!-- backdrop -->
    <button
      class="fixed inset-0 z-40"
      onclick={() => (open = false)}
      aria-label="Close menu"
      tabindex="-1"
    ></button>

    <!-- dropdown panel -->
    <div class="absolute right-0 top-full mt-1.5 z-50 w-56 bg-bg2 border border-border rounded-lg shadow-lg overflow-hidden">
      <!-- header -->
      <div class="px-3.5 py-3 border-b border-border">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-foreground truncate">{displayName}</p>
            <p class="text-[11px] text-muted truncate">{email}</p>
          </div>
          {#if role}
            <span class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/20 uppercase tracking-wide">
              {role}
            </span>
          {/if}
        </div>
      </div>

      <!-- actions -->
      <div class="py-1">
        <a
          href="/settings"
          onclick={() => (open = false)}
          class="flex items-center gap-2.5 px-3.5 py-2 text-sm text-muted hover:text-foreground hover:bg-bg3 transition-colors duration-100 no-underline"
        >
          <Settings size={14} />
          Profile settings
        </a>
        <button
          onclick={logout}
          class="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-muted hover:text-red-400 hover:bg-bg3 transition-colors duration-100"
        >
          <LogOut size={14} />
          Log out
        </button>
      </div>
    </div>
  {/if}
</div>
```

**Step 2: Validate with autofixer**

```bash
npx @sveltejs/mcp svelte-autofixer ./src/lib/components/ProfileMenu.svelte
```
Expected: no real issues (href warnings are false positives, ignore them)

**Step 3: Commit**

```bash
git add src/lib/components/ProfileMenu.svelte
git commit -m "feat: add ProfileMenu dropdown with user info and logout"
```

---

### Task 5: Rewrite Topbar with icons and new layout

**Files:**
- Modify: `src/lib/components/Topbar.svelte`

**Step 1: Rewrite the file**

Three-zone layout: `[HostPill + host tabs]` · `[MINION brand]` · `[global tabs + avatar]`

```svelte
<script lang="ts">
  import HostPill from './HostPill.svelte';
  import ProfileMenu from './ProfileMenu.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { page } from '$app/stores';
  import {
    Wrench,
    Users,
    Activity,
    SlidersHorizontal,
    Store,
    Settings,
  } from 'lucide-svelte';

  const isHome = $derived($page.url.pathname === '/');
  const isMarketplace = $derived($page.url.pathname.startsWith('/marketplace'));
  const isWorkshop = $derived($page.url.pathname.startsWith('/workshop'));
  const isUsers = $derived($page.url.pathname.startsWith('/users'));
  const isReliability = $derived($page.url.pathname.startsWith('/reliability'));
  const isConfig = $derived($page.url.pathname.startsWith('/config'));
  const isSettings = $derived($page.url.pathname.startsWith('/settings'));

  const subtitle = $derived(
    isMarketplace ? 'marketplace' : isWorkshop ? 'workshop' : 'hub'
  );
</script>

<header class="shrink-0 relative z-100 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center gap-2">
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <ScanLine speed={12} opacity={0.02} />
  </div>

  <!-- Left zone: host-specific -->
  <div class="flex items-center gap-2 shrink-0">
    <HostPill />
    <div class="w-px h-4 bg-border/60 mx-0.5 shrink-0"></div>
    <a href="/workshop" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isWorkshop ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Wrench size={12} /><span>Workshop</span>
    </a>
    <a href="/users" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isUsers ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Users size={12} /><span>Users</span>
    </a>
    <a href="/reliability" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isReliability ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Activity size={12} /><span>Reliability</span>
    </a>
    <a href="/config" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isConfig ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <SlidersHorizontal size={12} /><span>Config</span>
    </a>
  </div>

  <!-- Center: brand -->
  <a href="/" class="ml-auto mr-auto flex items-center select-none leading-none no-underline transition-opacity duration-150 {isHome ? 'opacity-100' : 'opacity-80 hover:opacity-100'}" aria-label="Minion Hub">
    <span class="bg-brand-pink text-black font-black text-[15px] tracking-wide px-2.5 py-0.5 rounded-l-md uppercase">MINION</span>
    <span class="text-white font-bold text-[15px] px-2 py-0.5">{subtitle}</span>
  </a>

  <!-- Right zone: global -->
  <div class="flex items-center gap-2 shrink-0">
    <a href="/marketplace" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isMarketplace ? 'bg-brand-pink/10 text-brand-pink border-brand-pink/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Store size={12} /><span>Marketplace</span>
    </a>
    <a href="/settings" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isSettings ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Settings size={12} /><span>Settings</span>
    </a>
    <ProfileMenu />
  </div>
</header>
```

**Step 2: Validate with autofixer**

```bash
npx @sveltejs/mcp svelte-autofixer ./src/lib/components/Topbar.svelte
```
Expected: only href false-positive warnings, no real issues

**Step 3: Commit**

```bash
git add src/lib/components/Topbar.svelte
git commit -m "feat: restructure Topbar with icons, host-left layout, and profile menu"
```

---

### Task 6: Smoke-test in browser

**Step 1: Start dev server**

```bash
bun run dev
```

**Step 2: Check these manually**

- [ ] Host-specific tabs (Workshop, Users, Reliability, Config) appear on the left after HostPill
- [ ] MINION brand in center, clickable, returns to `/`
- [ ] Marketplace + Settings on the right
- [ ] All icons render at correct size
- [ ] Profile avatar button (top-right) shows initials
- [ ] Clicking avatar opens dropdown with user name, email, role badge
- [ ] "Profile settings" link navigates to `/settings`
- [ ] "Log out" calls POST `/api/auth/logout` and redirects to `/login`
- [ ] Clicking outside dropdown closes it
- [ ] Esc key closes dropdown

**Step 3: Final commit (if any fixups needed)**

```bash
git add -p
git commit -m "fix: topbar polish after smoke test"
```
