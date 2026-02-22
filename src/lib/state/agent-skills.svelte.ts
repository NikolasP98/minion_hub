import { sendRequest } from '$lib/services/gateway.svelte';
import type { SkillStatusEntry, SkillStatusReport } from '$lib/types/skills';

export const agentSkillsState = $state({
  skills: [] as SkillStatusEntry[],
  agentFilter: null as string[] | null,
  loading: false,
  error: null as string | null,
});

export async function loadAgentSkills(agentId: string): Promise<void> {
  agentSkillsState.loading = true;
  agentSkillsState.error = null;
  try {
    const report = (await sendRequest('skills.status', { agentId })) as SkillStatusReport;
    agentSkillsState.skills = report.skills;
    agentSkillsState.agentFilter = report.agentFilter;
  } catch (e) {
    agentSkillsState.error = String(e);
  } finally {
    agentSkillsState.loading = false;
  }
}

export async function setAgentSkills(
  agentId: string,
  skills: string[] | null,
): Promise<void> {
  agentSkillsState.error = null;
  try {
    await sendRequest('agents.skills.set', { agentId, skills });
    agentSkillsState.agentFilter = skills;
    // Update local state to reflect the change
    if (skills === null) {
      for (const s of agentSkillsState.skills) s.agentEnabled = true;
    } else {
      const set = new Set(skills);
      for (const s of agentSkillsState.skills) s.agentEnabled = set.has(s.skillKey);
    }
  } catch (e) {
    agentSkillsState.error = String(e);
  }
}

export async function toggleGlobalSkill(
  skillKey: string,
  enabled: boolean,
): Promise<void> {
  agentSkillsState.error = null;
  try {
    await sendRequest('skills.update', { skillKey, enabled });
    // Optimistically update local state
    const skill = agentSkillsState.skills.find((s) => s.skillKey === skillKey);
    if (skill) skill.disabled = !enabled;
  } catch (e) {
    agentSkillsState.error = String(e);
  }
}
