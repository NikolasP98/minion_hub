import { goto } from '$app/navigation';
import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';
import { palettePageRoutes } from '$lib/nav/routes';
import { canClient } from '$lib/access/can.svelte';

export interface Command {
  id: string;
  label: string;
  category: 'page' | 'agent' | 'action' | 'record';
  icon?: string;
  keywords?: string;
  action: () => void;
}

export const palette = $state({
  open: false,
  query: '',
  selectedIndex: 0,
});

export function togglePalette() {
  palette.open = !palette.open;
  if (palette.open) {
    palette.query = '';
    palette.selectedIndex = 0;
  }
}

export function closePalette() {
  palette.open = false;
  palette.query = '';
  palette.selectedIndex = 0;
  recordResults.items = [];
}

// Page commands are generated from the canonical route registry
// ($lib/nav/routes) so the palette stays in sync with the sidebar — add a
// route there and it appears here automatically.
function pageCommands(): Command[] {
  return palettePageRoutes()
    .filter((r) => !r.requires || canClient(r.requires))
    .map((r) => ({
      id: `page:${r.path}`,
      label: r.title(),
      category: 'page' as const,
      icon: r.paletteIcon,
      keywords: r.keywords,
      action: () => goto(r.path),
    }));
}

const actionCommands: Command[] = [
  {
    id: 'action:new-agent',
    label: 'New Agent',
    category: 'action',
    icon: 'plus',
    keywords: 'create add agent',
    action: () => goto('/agents/builder'),
  },
  {
    id: 'action:settings',
    label: 'Open Settings',
    category: 'action',
    icon: 'settings',
    keywords: 'preferences configuration',
    action: () => goto('/settings'),
  },
];

const customCommands: Command[] = $state([]);

// Live record search results (contacts/tickets/orders) from /api/search — the
// "jump to any record" awesomebar half. Populated by runRecordSearch (debounced
// in the palette component); already server-matched, so not re-filtered client-side.
const recordResults = $state<{ items: Command[] }>({ items: [] });

let recordSearchSeq = 0;
export async function runRecordSearch(q: string): Promise<void> {
  const query = q.trim();
  if (query.length < 2) {
    recordResults.items = [];
    return;
  }
  const seq = ++recordSearchSeq;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    const { hits } = (await res.json()) as {
      hits: Array<{ type: string; id: string; label: string; sublabel: string | null; href: string; icon: string }>;
    };
    if (seq !== recordSearchSeq) return; // a newer query superseded this one
    recordResults.items = hits.map((h) => ({
      id: `record:${h.type}:${h.id}`,
      label: h.sublabel ? `${h.label} · ${h.sublabel}` : h.label,
      category: 'record' as const,
      icon: h.icon,
      action: () => goto(h.href),
    }));
  } catch {
    /* search is best-effort */
  }
}

export function registerCommand(cmd: Command) {
  customCommands.push(cmd);
}

export function unregisterCommand(id: string) {
  const idx = customCommands.findIndex((c) => c.id === id);
  if (idx !== -1) customCommands.splice(idx, 1);
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function getFilteredCommands(): { category: string; commands: Command[] }[] {
  // Build agent commands dynamically from gateway state
  const agentCommands: Command[] = visibleAgents.value.map((a) => ({
    id: `agent:${a.id}`,
    label: a.name ?? a.id,
    category: 'agent' as const,
    icon: a.emoji ?? 'bot',
    keywords: `agent ${a.name ?? ''} ${a.id}`,
    action: () => goto('/agents'),
  }));

  const all = [...pageCommands(), ...agentCommands, ...actionCommands, ...customCommands];
  const q = palette.query.trim();

  const filtered = q
    ? all.filter((c) => {
        const searchText = `${c.label} ${c.keywords ?? ''}`;
        return fuzzyMatch(searchText, q);
      })
    : all;

  // Group by category
  const groups: Record<string, Command[]> = {};
  const order = ['page', 'agent', 'action'];
  for (const cmd of filtered) {
    if (!groups[cmd.category]) groups[cmd.category] = [];
    groups[cmd.category].push(cmd);
  }

  const labels: Record<string, string> = { page: 'Pages', agent: 'Agents', action: 'Actions' };
  const out = order
    .filter((cat) => groups[cat]?.length)
    .map((cat) => ({ category: labels[cat] ?? cat, commands: groups[cat] }));

  // Live records (server-matched) lead the list when present.
  if (q && recordResults.items.length) {
    return [{ category: 'Records', commands: recordResults.items }, ...out];
  }
  return out;
}
