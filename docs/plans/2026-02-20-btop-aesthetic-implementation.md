# btop Aesthetic + Tailwind 4 Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Minion Hub's visual identity with btop-inspired terminal aesthetic, migrate from pure CSS to Tailwind 4, add theme system with settings page, delivered as 3 worktree branches at different aesthetic intensity levels.

**Architecture:** Base branch (`theme/base`) contains shared foundation — Tailwind 4 setup, `@theme` config, theme state/presets/provider, full component migration, settings page. Three child branches (`theme/subtle`, `theme/balanced`, `theme/immersive`) extend the base with progressively more intense decorative elements.

**Tech Stack:** Tailwind CSS 4, `@tailwindcss/vite`, Svelte 5 runes, CSS `@theme`/`@layer`, `@keyframes`, SVG patterns, Canvas API

---

## Phase 0: Foundation Setup

### Task 1: Install Tailwind 4 and configure Vite

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `svelte.config.js`
- Modify: `src/app.css`

**Step 1: Install Tailwind 4 and Vite plugin**

Run:
```bash
npm install tailwindcss@latest @tailwindcss/vite@latest
```

**Step 2: Add Tailwind Vite plugin**

`vite.config.ts`:
```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  optimizeDeps: {
    include: ['@zag-js/popover', '@zag-js/combobox'],
  },
  ssr: {
    noExternal: ['@zag-js/popover', '@zag-js/combobox', '@zag-js/svelte'],
  },
});
```

**Step 3: Replace app.css with Tailwind 4 `@theme` config**

`src/app.css`:
```css
@import 'tailwindcss';

/* ── Theme tokens ── */
@theme {
  /* Backgrounds */
  --color-bg: #09090b;
  --color-bg2: #18181b;
  --color-bg3: #27272a;

  /* Card / surface */
  --color-card: #0c0c0e;
  --color-card-foreground: #fafafa;

  /* Borders */
  --color-border: #27272a;

  /* Text hierarchy */
  --color-foreground: #fafafa;
  --color-muted: #a1a1aa;
  --color-muted-foreground: #71717a;

  /* Accent — overridden by theme presets */
  --color-accent: #3b82f6;
  --color-accent-foreground: #fafafa;

  /* Semantic status colors */
  --color-success: #22c55e;
  --color-destructive: #ef4444;
  --color-warning: #f59e0b;
  --color-purple: #a855f7;
  --color-pink: #ec4899;
  --color-cyan: #06b6d4;
  --color-emerald: #10b981;

  /* Agent status */
  --color-status-running: #22c55e;
  --color-status-thinking: #a855f7;
  --color-status-idle: #71717a;
  --color-status-aborted: #f59e0b;

  /* Brand */
  --color-brand-pink: #e8547a;

  /* Radius — shadcn NY uses tight radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
}

/* ── Base layer ── */
@layer base {
  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html,
  body {
    height: 100%;
    background: var(--color-bg);
    color: var(--color-foreground);
    overflow: hidden;
  }

  body {
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  a {
    color: var(--color-accent);
    text-decoration: none;
  }

  /* Scrollbar */
  ::-webkit-scrollbar {
    width: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 3px;
  }
}

/* ── Utility layer for custom animations ── */
@layer utilities {
  @keyframes led-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes dot-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  @keyframes glow-pulse {
    0%, 100% { box-shadow: 0 0 4px currentColor; }
    50% { box-shadow: 0 0 12px currentColor; }
  }

  @keyframes scan-line {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(100vh); }
  }
}
```

**Step 4: Verify dev server starts**

Run: `npm run dev`
Expected: Compiles without errors, page loads (may look broken — that's expected before migration)

**Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/app.css
git commit -m "feat: install tailwind 4 with @theme config (shadcn NY palette)"
```

---

### Task 2: Create theme state and presets

**Files:**
- Create: `src/lib/state/theme.svelte.ts`
- Create: `src/lib/themes/presets.ts`

**Step 1: Create theme presets**

`src/lib/themes/presets.ts`:
```ts
export interface ThemePreset {
  id: string;
  name: string;
  colors: {
    bg: string;
    bg2: string;
    bg3: string;
    card: string;
    cardForeground: string;
    border: string;
    foreground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    brandPink: string;
  };
}

export const ACCENT_OPTIONS = [
  { id: 'blue', label: 'Blue', value: '#3b82f6' },
  { id: 'purple', label: 'Purple', value: '#a855f7' },
  { id: 'green', label: 'Green', value: '#22c55e' },
  { id: 'cyan', label: 'Cyan', value: '#06b6d4' },
  { id: 'rose', label: 'Rose', value: '#f43f5e' },
  { id: 'amber', label: 'Amber', value: '#f59e0b' },
  { id: 'orange', label: 'Orange', value: '#f97316' },
  { id: 'emerald', label: 'Emerald', value: '#10b981' },
  { id: 'indigo', label: 'Indigo', value: '#6366f1' },
  { id: 'red', label: 'Red', value: '#ef4444' },
] as const;

export const PRESETS: ThemePreset[] = [
  {
    id: 'new-york',
    name: 'New York',
    colors: {
      bg: '#09090b',
      bg2: '#18181b',
      bg3: '#27272a',
      card: '#0c0c0e',
      cardForeground: '#fafafa',
      border: '#27272a',
      foreground: '#fafafa',
      muted: '#a1a1aa',
      mutedForeground: '#71717a',
      accent: '#3b82f6',
      accentForeground: '#fafafa',
      brandPink: '#e8547a',
    },
  },
  {
    id: 'btop-purple',
    name: 'btop Purple',
    colors: {
      bg: '#120a1e',
      bg2: '#1a1028',
      bg3: '#2a1a3e',
      card: '#160d22',
      cardForeground: '#e8d5f5',
      border: '#3d2a55',
      foreground: '#e8d5f5',
      muted: '#a87ec4',
      mutedForeground: '#7a5a96',
      accent: '#c084fc',
      accentForeground: '#fafafa',
      brandPink: '#e879a8',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    colors: {
      bg: '#0a0a0a',
      bg2: '#141414',
      bg3: '#1f1f1f',
      card: '#0d0d0d',
      cardForeground: '#e0ffe0',
      border: '#1a3a1a',
      foreground: '#e0ffe0',
      muted: '#66bb6a',
      mutedForeground: '#388e3c',
      accent: '#00e676',
      accentForeground: '#0a0a0a',
      brandPink: '#ff4081',
    },
  },
  {
    id: 'midnight-ocean',
    name: 'Midnight Ocean',
    colors: {
      bg: '#0a1628',
      bg2: '#0f1e35',
      bg3: '#162a48',
      card: '#0c1a2e',
      cardForeground: '#e0f0ff',
      border: '#1e3a5c',
      foreground: '#e0f0ff',
      muted: '#6ba3cc',
      mutedForeground: '#4a7a9e',
      accent: '#38bdf8',
      accentForeground: '#0a1628',
      brandPink: '#f472b6',
    },
  },
];
```

**Step 2: Create reactive theme state**

`src/lib/state/theme.svelte.ts`:
```ts
import { PRESETS, ACCENT_OPTIONS, type ThemePreset } from '$lib/themes/presets';

const STORAGE_KEY = 'minion-hub-theme';

interface ThemeConfig {
  presetId: string;
  accentId: string;
}

function loadConfig(): ThemeConfig {
  if (typeof localStorage === 'undefined') return { presetId: 'new-york', accentId: 'blue' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { presetId: 'new-york', accentId: 'blue' };
}

function saveConfig(cfg: ThemeConfig) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

const initial = loadConfig();
let presetId = $state(initial.presetId);
let accentId = $state(initial.accentId);

const preset = $derived(PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]);
const accent = $derived(ACCENT_OPTIONS.find((a) => a.id === accentId) ?? ACCENT_OPTIONS[0]);

export const theme = {
  get presetId() { return presetId; },
  get accentId() { return accentId; },
  get preset() { return preset; },
  get accent() { return accent; },
  get presets() { return PRESETS; },
  get accents() { return ACCENT_OPTIONS; },

  setPreset(id: string) {
    presetId = id;
    saveConfig({ presetId, accentId });
  },
  setAccent(id: string) {
    accentId = id;
    saveConfig({ presetId, accentId });
  },
};

/** Apply theme CSS variables to :root — call in root layout $effect */
export function applyTheme(p: ThemePreset, accentValue: string) {
  const root = document.documentElement;
  root.style.setProperty('--color-bg', p.colors.bg);
  root.style.setProperty('--color-bg2', p.colors.bg2);
  root.style.setProperty('--color-bg3', p.colors.bg3);
  root.style.setProperty('--color-card', p.colors.card);
  root.style.setProperty('--color-card-foreground', p.colors.cardForeground);
  root.style.setProperty('--color-border', p.colors.border);
  root.style.setProperty('--color-foreground', p.colors.foreground);
  root.style.setProperty('--color-muted', p.colors.muted);
  root.style.setProperty('--color-muted-foreground', p.colors.mutedForeground);
  root.style.setProperty('--color-accent', accentValue);
  root.style.setProperty('--color-accent-foreground', p.colors.accentForeground);
  root.style.setProperty('--color-brand-pink', p.colors.brandPink);
}
```

**Step 3: Commit**

```bash
git add src/lib/themes/presets.ts src/lib/state/theme.svelte.ts
git commit -m "feat: theme presets and reactive state with localStorage persistence"
```

---

### Task 3: Wire theme into root layout

**Files:**
- Modify: `src/routes/+layout.svelte`

**Step 1: Add theme $effect to layout**

Replace `src/routes/+layout.svelte`:
```svelte
<script lang="ts">
  import '../app.css';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import ShutdownBanner from '$lib/components/ShutdownBanner.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
  });
</script>

<ParticleCanvas />
<ShutdownBanner />
{@render children()}
```

**Step 2: Verify theme applies on load**

Run: `npm run dev`
Expected: Page loads with New York (zinc) color scheme. Changing localStorage `minion-hub-theme` and refreshing switches theme.

**Step 3: Commit**

```bash
git add src/routes/+layout.svelte
git commit -m "feat: wire theme state into root layout effect"
```

---

## Phase 1: Component Migration (Tailwind 4)

Each component below is migrated from scoped `<style>` to Tailwind utility classes. The old `<style>` block is removed entirely. CSS variable references change from `var(--bg)` to `var(--color-bg)` etc. since we renamed them in the `@theme` block.

### Task 4: Migrate root page + layout components

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/Topbar.svelte`
- Modify: `src/lib/components/AgentSidebar.svelte`
- Modify: `src/lib/components/DetailPanel.svelte`

**Step 1: Migrate `+page.svelte`**

Replace with:
```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Topbar from '$lib/components/Topbar.svelte';
  import AgentSidebar from '$lib/components/AgentSidebar.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import { loadHosts, hostsState } from '$lib/state/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';

  onMount(() => {
    loadHosts();
    if (hostsState.activeHostId) wsConnect();
  });
</script>

<div class="flex flex-col h-screen overflow-hidden">
  <Topbar />
  <div class="flex flex-1 min-h-0 overflow-hidden">
    <AgentSidebar />
    <DetailPanel />
  </div>
</div>
```

**Step 2: Migrate `Topbar.svelte`**

Replace with (remove `<style>` block, use Tailwind classes):
```svelte
<script lang="ts">
  import HostPill from './HostPill.svelte';
  import { conn } from '$lib/state/connection.svelte';
</script>

<header class="shrink-0 relative z-100 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center gap-2.5">
  <HostPill />

  <div
    class="w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300"
    class:bg-success={conn.connected}
    class:shadow-[0_0_8px_var(--color-success)]={conn.connected}
    class:bg-warning={conn.connecting}
    class:shadow-[0_0_8px_var(--color-warning)]={conn.connecting}
    class:animate-[led-pulse_1s_infinite]={conn.connecting}
    class:bg-muted-foreground={!conn.connected && !conn.connecting}
    class:shadow-[0_0_4px_var(--color-muted-foreground)]={!conn.connected && !conn.connecting}
  ></div>
  <span class="text-xs text-muted whitespace-nowrap">{conn.statusText}</span>

  <div class="ml-auto mr-auto flex items-center select-none leading-none" aria-label="Minion Hub">
    <span class="bg-brand-pink text-black font-black text-[15px] tracking-wide px-2.5 py-0.5 rounded-l-md uppercase">MINION</span>
    <span class="text-white font-bold text-[15px] px-2 py-0.5">hub</span>
  </div>

  <a href="/reliability" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">Reliability</a>
  <a href="/sessions" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">Sessions</a>
  <a href="/settings" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">Settings</a>
</header>
```

**Step 3: Migrate `AgentSidebar.svelte`**

Replace with (Tailwind, remove `<style>`):
```svelte
<script lang="ts">
  import AgentRow from './AgentRow.svelte';
  import GatewayInfo from './GatewayInfo.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import AddAgentModal from './AddAgentModal.svelte';

  const ACCENT_COLORS = [
    '#3b82f6', '#22c55e', '#a855f7', '#ec4899',
    '#06b6d4', '#f59e0b', '#10b981', '#ef4444',
  ];
</script>

<aside class="w-[260px] shrink-0 overflow-hidden border-r border-border bg-bg2 flex flex-col">
  <div class="flex items-center justify-center px-3 py-3.5 border-b border-border select-none leading-none">
    <span class="bg-brand-pink text-black font-black text-sm tracking-wide px-2 py-0.5 rounded-l-[5px] uppercase">MINION</span>
    <span class="text-white font-bold text-sm px-1.5 py-0.5">hub</span>
  </div>

  <div class="px-3.5 py-2.5 text-[10px] font-bold tracking-widest uppercase text-muted-foreground border-b border-border shrink-0 flex items-center justify-between">
    <span>Agents</span>
    <button
      class="flex items-center justify-center w-5 h-5 p-0 border border-border rounded-sm bg-transparent text-muted-foreground text-base leading-none cursor-pointer transition-all duration-150 hover:text-foreground hover:border-muted hover:bg-bg3"
      onclick={() => { ui.agentAddOpen = true; }}
      aria-label="Add agent"
    >+</button>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if !conn.connected}
      <div class="py-7 px-3.5 text-center text-muted-foreground text-xs">
        {conn.connecting ? 'Connecting…' : 'Not connected'}
      </div>
    {:else if gw.agents.length === 0}
      <div class="py-7 px-3.5 text-center text-muted-foreground text-xs">No agents</div>
    {:else}
      {#each gw.agents as agent, i (agent.id)}
        <AgentRow
          {agent}
          selected={ui.selectedAgentId === agent.id}
          accentColor={ACCENT_COLORS[i % ACCENT_COLORS.length]}
          onclick={() => { ui.selectedAgentId = agent.id; }}
        />
      {/each}
    {/if}
  </div>

  <div class="shrink-0 px-2.5 py-2 border-t border-border">
    <GatewayInfo />
  </div>
</aside>

{#if ui.agentAddOpen}
  <AddAgentModal />
{/if}
```

**Step 4: Migrate `DetailPanel.svelte`**

Replace with:
```svelte
<script lang="ts">
  import AgentDetail from './AgentDetail.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { gw } from '$lib/state/gateway-data.svelte';
  import { conn } from '$lib/state/connection.svelte';

  const agent = $derived(gw.agents.find((a) => (a as { id: string }).id === ui.selectedAgentId) ?? null);
</script>

<section class="flex-1 min-w-0 flex flex-col overflow-hidden">
  {#if agent && ui.selectedAgentId}
    <AgentDetail agentId={ui.selectedAgentId} {agent} />
  {:else}
    <div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      {#if !conn.connected}
        Connect to a gateway to get started
      {:else if gw.agents.length === 0}
        No agents found
      {:else}
        Select an agent from the sidebar
      {/if}
    </div>
  {/if}
</section>
```

**Step 5: Verify main page renders**

Run: `npm run dev`
Expected: Main page structure renders with correct layout (sidebar + detail panel).

**Step 6: Commit**

```bash
git add src/routes/+page.svelte src/lib/components/Topbar.svelte src/lib/components/AgentSidebar.svelte src/lib/components/DetailPanel.svelte
git commit -m "feat: migrate root page + layout components to tailwind 4"
```

---

### Task 5: Migrate agent-related components

**Files:**
- Modify: `src/lib/components/AgentRow.svelte`
- Modify: `src/lib/components/AgentDetail.svelte`
- Modify: `src/lib/components/DetailHeader.svelte`

**Goal:** Convert these 3 components from scoped CSS to Tailwind utilities. Remove all `<style>` blocks. Map `var(--X)` to `var(--color-X)`. Use Tailwind classes for layout, spacing, colors, typography. For dynamic styles (e.g., accent color passed as prop), use inline `style:` bindings. Keep all existing functionality intact.

Each component should:
1. Replace every CSS class with equivalent Tailwind utilities
2. Remove the entire `<style>` block
3. Use `class:` directives for conditional styling
4. Use `style:` for dynamic values (accent colors, etc.)

**After migration, commit:**
```bash
git add src/lib/components/AgentRow.svelte src/lib/components/AgentDetail.svelte src/lib/components/DetailHeader.svelte
git commit -m "feat: migrate agent components to tailwind 4"
```

---

### Task 6: Migrate chat components

**Files:**
- Modify: `src/lib/components/ChatPanel.svelte`
- Modify: `src/lib/components/ChatMessage.svelte`

**Goal:** Same pattern as Task 5. Convert chat panel (scrollable message area + input textarea + send button) and message bubbles (role-based styling with user=pink, assistant=dark) to Tailwind utilities.

**After migration, commit:**
```bash
git add src/lib/components/ChatPanel.svelte src/lib/components/ChatMessage.svelte
git commit -m "feat: migrate chat components to tailwind 4"
```

---

### Task 7: Migrate host/gateway components

**Files:**
- Modify: `src/lib/components/HostPill.svelte`
- Modify: `src/lib/components/HostDropdown.svelte`
- Modify: `src/lib/components/HostsOverlay.svelte`
- Modify: `src/lib/components/GatewayInfo.svelte`

**Goal:** Convert host pill (status indicator + dropdown trigger), dropdown menu, modal overlay, and gateway info tags to Tailwind. The HostsOverlay is a modal with form inputs — use Tailwind form styling.

**After migration, commit:**
```bash
git add src/lib/components/HostPill.svelte src/lib/components/HostDropdown.svelte src/lib/components/HostsOverlay.svelte src/lib/components/GatewayInfo.svelte
git commit -m "feat: migrate host/gateway components to tailwind 4"
```

---

### Task 8: Migrate session components

**Files:**
- Modify: `src/lib/components/SessionCard.svelte`
- Modify: `src/lib/components/SessionDropdown.svelte`
- Modify: `src/lib/components/SessionViewer.svelte`
- Modify: `src/lib/components/SessionsList.svelte`
- Modify: `src/routes/sessions/+page.svelte`

**Goal:** Convert all session-related components and the sessions route page. SessionViewer has a transcript display with message rendering. SessionsList has search input, agent filter chips, and grouped session list.

**After migration, commit:**
```bash
git add src/lib/components/SessionCard.svelte src/lib/components/SessionDropdown.svelte src/lib/components/SessionViewer.svelte src/lib/components/SessionsList.svelte src/routes/sessions/+page.svelte
git commit -m "feat: migrate session components to tailwind 4"
```

---

### Task 9: Migrate kanban/mission components

**Files:**
- Modify: `src/lib/components/MissionContext.svelte`
- Modify: `src/lib/components/TaskCard.svelte`
- Modify: `src/lib/components/KanbanBoard.svelte`
- Modify: `src/lib/components/KanbanCol.svelte`

**Goal:** Convert kanban board with 4 columns, draggable task cards, and mission context dropdown. TaskCard uses cursor: grab and has drag event handlers — preserve those.

**After migration, commit:**
```bash
git add src/lib/components/MissionContext.svelte src/lib/components/TaskCard.svelte src/lib/components/KanbanBoard.svelte src/lib/components/KanbanCol.svelte
git commit -m "feat: migrate kanban/mission components to tailwind 4"
```

---

### Task 10: Migrate reliability dashboard

**Files:**
- Modify: `src/routes/reliability/+page.svelte`
- Modify: `src/lib/components/reliability/DateRangePicker.svelte`
- Modify: `src/lib/components/reliability/KpiCard.svelte`
- Modify: `src/lib/components/reliability/IncidentTable.svelte`
- Modify: `src/lib/components/reliability/CredentialHealthPanel.svelte`
- Modify: `src/lib/components/reliability/GatewayHealthPanel.svelte`
- Modify: `src/lib/components/reliability/SkillStatsPanel.svelte`

**Goal:** Convert the entire reliability dashboard. KpiCard has a left accent bar (keep via border-l-4 + dynamic color). IncidentTable has sortable columns with severity/category badges. CredentialHealthPanel and SkillStatsPanel have color-coded status indicators.

**After migration, commit:**
```bash
git add src/routes/reliability/+page.svelte src/lib/components/reliability/
git commit -m "feat: migrate reliability dashboard to tailwind 4"
```

---

### Task 11: Migrate remaining components

**Files:**
- Modify: `src/lib/components/Chart.svelte`
- Modify: `src/lib/components/Sparkline.svelte`
- Modify: `src/lib/components/ParticleCanvas.svelte`
- Modify: `src/lib/components/ShutdownBanner.svelte`
- Modify: `src/lib/components/AddAgentModal.svelte`

**Goal:** Chart and Sparkline are ECharts wrappers — minimal CSS to convert. ParticleCanvas is a fixed-position canvas — convert position/z-index styles. ShutdownBanner is a fixed top banner. AddAgentModal is the most complex — modal overlay with emoji picker, combobox, form inputs, validation display.

**After migration, commit:**
```bash
git add src/lib/components/Chart.svelte src/lib/components/Sparkline.svelte src/lib/components/ParticleCanvas.svelte src/lib/components/ShutdownBanner.svelte src/lib/components/AddAgentModal.svelte
git commit -m "feat: migrate remaining components to tailwind 4"
```

---

### Task 12: Verify full migration — clean build

**Step 1: Run type check**

Run: `npm run check`
Expected: No type errors

**Step 2: Run build**

Run: `npm run build`
Expected: Builds successfully

**Step 3: Run dev server and visually verify all routes**

Run: `npm run dev`
Verify: `/`, `/reliability`, `/sessions` all render correctly with the new zinc-based theme

**Step 4: Confirm no remaining scoped `<style>` blocks (except keyframes referenced by Tailwind)**

Run: `grep -rn '<style>' src/lib/components/ src/routes/`
Expected: No matches (all styles migrated to Tailwind)

**Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "chore: verify and clean up tailwind migration"
```

---

## Phase 2: Settings Page

### Task 13: Create settings route

**Files:**
- Create: `src/routes/settings/+page.svelte`

**Step 1: Create the settings page**

`src/routes/settings/+page.svelte` — a full settings page with:
- Back navigation / page title
- **Theme Presets** section: a 2x2 grid of preset cards. Each card shows the preset name and a mini color palette preview (4-5 colored rectangles showing bg, bg2, card, border, accent). Active preset has accent border + checkmark.
- **Accent Color** section: a horizontal row of circular color swatches. Active swatch has ring + scale effect.
- All changes apply instantly via `theme.setPreset()` / `theme.setAccent()` calls.
- Layout: centered max-width container (~600px) with the same bg as the main app.

The page should use Tailwind classes exclusively. Import `theme` from `$lib/state/theme.svelte` for reading/writing state.

**Step 2: Verify settings page works**

Run: `npm run dev`, navigate to `/settings`
Expected: Theme presets render, clicking one changes the app colors immediately. Accent swatches work. Refreshing preserves selection.

**Step 3: Commit**

```bash
git add src/routes/settings/+page.svelte
git commit -m "feat: settings page with theme presets and accent color picker"
```

---

## Phase 3: Decorative Components

### Task 14: Create shared decorative components

**Files:**
- Create: `src/lib/components/decorations/DotGrid.svelte`
- Create: `src/lib/components/decorations/StatusDot.svelte`
- Create: `src/lib/components/decorations/CornerAccent.svelte`
- Create: `src/lib/components/decorations/HudBorder.svelte`
- Create: `src/lib/components/decorations/ScanLine.svelte`
- Create: `src/lib/components/decorations/DotMatrix.svelte`
- Create: `src/lib/components/decorations/DataRain.svelte`
- Create: `src/lib/components/decorations/GlitchText.svelte`

**DotGrid.svelte** — An SVG-based repeating dot grid pattern used as a decorative background. Props: `opacity` (0-1, default 0.08), `dotSize` (px, default 1.5), `gap` (px, default 16), `color` (CSS color, default `var(--color-accent)`). Renders as absolute-positioned SVG with `pointer-events-none`. Uses `<pattern>` element for efficient tiling.

**StatusDot.svelte** — Animated pulsing circle indicator. Props: `status` ('running' | 'thinking' | 'idle' | 'aborted'), `size` ('sm' | 'md' | 'lg'). Maps status to color (green/purple/gray/amber). Renders a div with rounded-full, bg color, and `animate-[dot-pulse_2s_infinite]` for active states. Idle has no animation.

**CornerAccent.svelte** — Small cluster of 3-5 tiny dots positioned in a corner of a parent container. Props: `position` ('top-right' | 'top-left' | 'bottom-right' | 'bottom-left'), `color`. Renders absolutely positioned tiny circles (2px each) in a triangular cluster pattern.

**HudBorder.svelte** — Decorative container wrapper with corner bracket accents and optional dot-matrix underline on header areas. Props: `class` (passthrough). Renders slot content inside a div with pseudo-element corner brackets (using Tailwind's `before:` and `after:` utilities or a tiny inner SVG).

**ScanLine.svelte** — CSS-only scan line overlay. A thin horizontal gradient line that slowly moves down the container. Props: `speed` (seconds, default 8), `opacity` (default 0.03). Uses `animate-[scan-line]` with absolute positioning and `pointer-events-none`.

**DotMatrix.svelte** — Small grid of dots (e.g. 8x4) that pulse/light up based on data. Props: `data` (number[], values 0-1 mapped to opacity), `cols` (default 8), `color`. Renders a CSS grid of tiny divs with dynamic opacity. Used for activity visualization.

**DataRain.svelte** — Canvas-based falling character/dot effect (like Matrix rain but with dots and tiny symbols). Props: `density` (low/medium/high), `color`, `speed`. Uses requestAnimationFrame + canvas. Characters are tiny (8-10px) monospace glyphs that fall and fade.

**GlitchText.svelte** — Text wrapper that applies a CSS glitch effect on hover. Props: `intensity` ('subtle' | 'medium' | 'heavy'). Uses clip-path + translate keyframes on `::before`/`::after` pseudo-elements with the text content. Slot-based — wraps children.

**Step 1: Create all 8 components**

Each component should use Tailwind classes where possible and minimal scoped CSS only for things Tailwind can't express (like SVG pattern definitions or complex pseudo-element content).

**Step 2: Commit**

```bash
git add src/lib/components/decorations/
git commit -m "feat: create decorative btop-inspired components library"
```

---

## Phase 4: Branch Divergence

At this point, the base work is done. Now create 3 worktree branches and apply branch-specific decorative integration.

### Task 15: Create worktree branches

**Step 1: Commit and tag the base**

```bash
git tag theme-base
```

**Step 2: Create worktree branches**

```bash
git worktree add .claude/worktrees/theme-subtle theme/subtle -b theme/subtle
git worktree add .claude/worktrees/theme-balanced theme/balanced -b theme/balanced
git worktree add .claude/worktrees/theme-immersive theme/immersive -b theme/immersive
```

**Step 3: Commit tag**

No commit needed — worktrees are ready.

---

### Task 16: Integrate subtle decorations (`theme/subtle`)

**Working directory:** `.claude/worktrees/theme-subtle/`

**Goal:** Refined, professional dashboard with terminal-inspired touches.

**Changes:**
1. **`+page.svelte`** — Add `<DotGrid opacity={0.06} />` inside the main content area as a background layer
2. **`Topbar.svelte`** — Replace the `conn-led` div with `<StatusDot status={...} size="sm" />`
3. **`AgentRow.svelte`** — Add `<StatusDot>` next to agent name showing their activity status
4. **`KpiCard.svelte`** — Add `<CornerAccent position="top-right" />` inside each card
5. **`DetailPanel.svelte`** — Add `<DotGrid opacity={0.04} />` as background on empty state
6. **`ParticleCanvas.svelte`** — Reduce particle count to ~30, slow speed by 50%, increase fade/transparency
7. **`GatewayHealthPanel.svelte`** — Add `<StatusDot>` next to gateway status indicators

**After changes, commit:**
```bash
git add -A
git commit -m "feat(subtle): integrate refined btop-inspired decorative touches"
```

---

### Task 17: Integrate balanced decorations (`theme/balanced`)

**Working directory:** `.claude/worktrees/theme-balanced/`

**Goal:** Sci-fi command center that's still comfortably usable.

**Changes (includes everything from subtle, plus):**
1. All changes from Task 16
2. **`AgentSidebar.svelte`** — Wrap with `<HudBorder>`, add `<DotMatrix>` in sidebar footer showing gateway activity
3. **`Topbar.svelte`** — Add `<ScanLine speed={12} opacity={0.02} />` overlay
4. **`KpiCard.svelte`** — Add glow `shadow-[0_0_12px_var(--color-accent)]/10` on hover
5. **`+page.svelte`** — Add `<DotGrid opacity={0.08} />` as full-page background
6. **`DetailHeader.svelte`** — Add `<HudBorder>` wrapper with dot-matrix underline
7. **`reliability/+page.svelte`** — Add `<ScanLine>` over chart panels, `<DotMatrix>` in KPI cards showing trend data
8. **`ParticleCanvas.svelte`** — Standard particle count (~50), add connection lines between nearby particles (draw line when distance < 120px)

**After changes, commit:**
```bash
git add -A
git commit -m "feat(balanced): integrate sci-fi command center decorative elements"
```

---

### Task 18: Integrate immersive decorations (`theme/immersive`)

**Working directory:** `.claude/worktrees/theme-immersive/`

**Goal:** Deep btop / cyberpunk terminal aesthetic.

**Changes (includes everything from balanced, plus):**
1. All changes from Task 17
2. **`AgentSidebar.svelte`** — Dense `<DotGrid opacity={0.2} dotSize={1} gap={10} />` on sidebar background
3. **`DetailPanel.svelte` empty state** — Replace text with `<DataRain density="medium" />` background + text overlay
4. **`Topbar.svelte`** — Wrap logo text with `<GlitchText intensity="subtle">`
5. **`+layout.svelte`** — Add full-screen `<DotGrid opacity={0.025} gap={24} />` overlay across entire app (lowest z-index)
6. **`ChatPanel.svelte`** — Add terminal cursor blink animation on the input area (blinking block cursor via CSS)
7. **`SessionViewer.svelte`** — Add `<ScanLine speed={6} opacity={0.04} />` across the transcript area
8. **`KanbanBoard.svelte`** — Add `<HudBorder>` wrappers on columns
9. **`ParticleCanvas.svelte`** — Full density (~80 particles), connection lines, reactive to cursor (particles attracted/repelled within 200px radius), faster movement
10. **Hover effects** — Add `<GlitchText intensity="subtle">` on nav links, sidebar header, section titles

**After changes, commit:**
```bash
git add -A
git commit -m "feat(immersive): integrate deep btop/cyberpunk terminal aesthetic"
```

---

## Phase 5: Final Verification

### Task 19: Verify all 3 branches build and render

**For each worktree (`theme-subtle`, `theme-balanced`, `theme-immersive`):**

1. `cd` into worktree directory
2. Run `npm run check` — no type errors
3. Run `npm run build` — builds successfully
4. Run `npm run dev` — start dev server
5. Verify all routes render: `/`, `/reliability`, `/sessions`, `/settings`
6. Verify theme switching works on `/settings`
7. Verify decorative elements are visible and performant (no jank, no layout shifts)

---

## File Inventory

**New files (shared):**
- `src/lib/themes/presets.ts`
- `src/lib/state/theme.svelte.ts`
- `src/routes/settings/+page.svelte`
- `src/lib/components/decorations/DotGrid.svelte`
- `src/lib/components/decorations/StatusDot.svelte`
- `src/lib/components/decorations/CornerAccent.svelte`
- `src/lib/components/decorations/HudBorder.svelte`
- `src/lib/components/decorations/ScanLine.svelte`
- `src/lib/components/decorations/DotMatrix.svelte`
- `src/lib/components/decorations/DataRain.svelte`
- `src/lib/components/decorations/GlitchText.svelte`

**Modified files (all existing components):**
- `package.json` (tailwind deps)
- `vite.config.ts` (tailwind plugin)
- `src/app.css` (full rewrite to @theme)
- `src/routes/+layout.svelte` (theme effect)
- `src/routes/+page.svelte`
- `src/routes/reliability/+page.svelte`
- `src/routes/sessions/+page.svelte`
- All 28 components in `src/lib/components/` (CSS → Tailwind)
