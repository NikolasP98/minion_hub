import type { AutonomousAgentVM, SystemAgentStatus } from './autonomous';

export interface ArtifactDescriptor {
  id: string;          // bundle id, unique among artifact bundles (e.g. "overview")
  agentId: string;     // owning agent id (e.g. "scheduling.reminders")
  slot: 'detail';      // render surface (phase 1: the agent detail page)
  title: string;       // shown in the host shell header
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
}

/** The built-in "overview" artifact, attached to any agent. `title` is localized by the caller. */
export function overviewDescriptorFor(agentId: string, title: string): ArtifactDescriptor {
  return { id: 'overview', agentId, slot: 'detail', title, kind: 'static', entrypoint: 'index.html' };
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
