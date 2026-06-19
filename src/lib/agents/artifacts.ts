import type { AutonomousAgentVM, SystemAgentStatus } from './autonomous';

export interface ArtifactDescriptor {
  id: string;          // bundle id, unique among artifact bundles (e.g. "overview")
  agentId: string;     // owning agent id (e.g. "scheduling.reminders")
  slot: 'detail';      // render surface (phase 1: the agent detail page)
  title: string;       // shown in the host shell header
  description: string; // shown in the gallery tile popover
  icon: string;        // lucide icon name (resolved via resolvePluginIcon)
  kind: 'static';      // 'live' reserved for later
  entrypoint: string;  // bundle path, e.g. "index.html"
}

export interface ArtifactContext {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentDescription: string;
  status: SystemAgentStatus;
  trigger: string | null;
  data?: TriageArtifactData;
}

export interface TriageArtifactData {
  counts: { total: number; high: number; med: number; low: number; notified: number; responded: number };
  recent: Array<{ severity: 'low' | 'med' | 'high'; category: string; summary: string; createdAt: number }>;
}

/** The built-in "overview" artifact, attached to any agent. Strings are localized by the caller. */
export function overviewDescriptorFor(agentId: string, title: string, description: string): ArtifactDescriptor {
  return { id: 'overview', agentId, slot: 'detail', title, description, icon: 'LayoutDashboard', kind: 'static', entrypoint: 'index.html' };
}

export function agentVmToArtifactContext(vm: AutonomousAgentVM): ArtifactContext {
  return {
    agentId: vm.id,
    agentName: vm.name,
    agentRole: vm.role,
    agentDescription: vm.description,
    status: vm.status,
    trigger: vm.trigger,
  };
}

/** Same-origin iframe src: the hub serves both the page and the artifact bundle. */
export function artifactSrc(descriptor: ArtifactDescriptor, origin: string): string {
  return `${origin}/artifacts/${descriptor.id}/ui/${descriptor.entrypoint}#hostOrigin=${encodeURIComponent(origin)}`;
}

/** The triage artifact, attached to the alert-watcher (Triage) agent. Strings localized by the caller. */
export function triageDescriptorFor(agentId: string, title: string, description: string): ArtifactDescriptor {
  return { id: 'triage', agentId, slot: 'detail', title, description, icon: 'Megaphone', kind: 'static', entrypoint: 'index.html' };
}

/** Card-pill detail string from alert counts (pure; null = gateway unavailable). */
export function triageStatusDetail(counts: TriageArtifactData['counts'] | null): string {
  if (!counts) return 'Status unavailable';
  if (counts.total === 0) return 'No alerts in 30d';
  return `${counts.total} alerts · ${counts.high} high (30d)`;
}

/** Map gateway ComplaintRow records to the artifact's recent[] (pure; drops malformed). */
export function mapRecentRows(rows: Array<Record<string, unknown>>): TriageArtifactData['recent'] {
  const out: TriageArtifactData['recent'] = [];
  for (const r of rows) {
    const severity = r.severity;
    if (severity !== 'low' && severity !== 'med' && severity !== 'high') continue;
    if (typeof r.category !== 'string' || typeof r.summary !== 'string' || typeof r.created_at !== 'number') continue;
    out.push({ severity, category: r.category, summary: r.summary, createdAt: r.created_at });
  }
  return out;
}
