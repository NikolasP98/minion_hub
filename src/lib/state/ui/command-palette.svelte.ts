import { goto } from '$app/navigation';
import { visibleAgents } from '$lib/state/gateway/gateway-data.svelte';

export interface Command {
  id: string;
  label: string;
  category: 'page' | 'agent' | 'action';
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
}

const staticCommands: Command[] = [
  { id: 'page:dashboard', label: 'Dashboard', category: 'page', icon: 'home', keywords: 'home overview', action: () => goto('/') },
  { id: 'page:my-agent', label: 'My Agent', category: 'page', icon: 'user', keywords: 'personal agent', action: () => goto('/my-agent') },
  { id: 'page:builder', label: 'Builder', category: 'page', icon: 'book-open', keywords: 'create edit agents tools skills', action: () => goto('/builder') },
  { id: 'page:marketplace', label: 'Marketplace', category: 'page', icon: 'store', keywords: 'plugins tools marketplace browse', action: () => goto('/marketplace') },
  { id: 'page:reliability', label: 'Reliability', category: 'page', icon: 'activity', keywords: 'health monitoring events', action: () => goto('/reliability') },
  { id: 'page:sessions', label: 'Sessions', category: 'page', icon: 'messages-square', keywords: 'conversations history', action: () => goto('/sessions') },
  { id: 'page:settings', label: 'Settings', category: 'page', icon: 'settings', keywords: 'preferences config', action: () => goto('/settings') },
  { id: 'page:workshop', label: 'Workshop', category: 'page', icon: 'wrench', keywords: 'test experiment sandbox', action: () => goto('/workshop') },
  { id: 'page:flow-editor', label: 'Flow Editor', category: 'page', icon: 'git-branch', keywords: 'flows graph editor', action: () => goto('/flow-editor') },
  { id: 'action:new-agent', label: 'New Agent', category: 'action', icon: 'plus', keywords: 'create add agent', action: () => goto('/builder') },
  { id: 'action:settings', label: 'Open Settings', category: 'action', icon: 'settings', keywords: 'preferences configuration', action: () => goto('/settings') },
];

const customCommands: Command[] = $state([]);

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
    action: () => goto('/'),
  }));

  const all = [...staticCommands, ...agentCommands, ...customCommands];
  const q = palette.query.trim();

  const filtered = q ? all.filter((c) => {
    const searchText = `${c.label} ${c.keywords ?? ''}`;
    return fuzzyMatch(searchText, q);
  }) : all;

  // Group by category
  const groups: Record<string, Command[]> = {};
  const order = ['page', 'agent', 'action'];
  for (const cmd of filtered) {
    if (!groups[cmd.category]) groups[cmd.category] = [];
    groups[cmd.category].push(cmd);
  }

  const labels: Record<string, string> = { page: 'Pages', agent: 'Agents', action: 'Actions' };
  return order
    .filter((cat) => groups[cat]?.length)
    .map((cat) => ({ category: labels[cat] ?? cat, commands: groups[cat] }));
}
