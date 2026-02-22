export interface SkillStatusEntry {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  agentEnabled: boolean;
  always: boolean;
  requirements: { bins?: string[]; env?: string[]; configPaths?: string[] };
  missing: { bins?: string[]; env?: string[]; configPaths?: string[] };
  install: { id: string; kind: string; label: string; bins: string[] }[];
}

export interface SkillStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
  agentFilter: string[] | null;
}
