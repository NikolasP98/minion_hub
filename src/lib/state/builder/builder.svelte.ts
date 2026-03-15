export interface BuiltSkillSummary {
  id: string;
  name: string;
  description: string;
  emoji: string;
  status: 'draft' | 'published';
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface BuiltAgentSummary {
  id: string;
  name: string;
  emoji: string;
  description: string;
  model: string | null;
  status: 'draft' | 'published';
  createdAt: number;
  updatedAt: number;
}

export interface BuiltToolSummary {
  id: string;
  name: string;
  description: string;
  scriptLang: string;
  status: 'draft' | 'published';
  createdAt: number;
  updatedAt: number;
}

export const builderState = $state({
  skills: [] as BuiltSkillSummary[],
  agents: [] as BuiltAgentSummary[],
  tools: [] as BuiltToolSummary[],
  loading: false,
  error: null as string | null,
});

export async function loadBuiltSkills() {
  builderState.loading = true;
  builderState.error = null;
  try {
    const res = await fetch('/api/builder/skills');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    builderState.skills = data.skills;
  } catch (e) {
    builderState.error = e instanceof Error ? e.message : 'Failed to load skills';
  } finally {
    builderState.loading = false;
  }
}

export async function loadBuiltAgents() {
  try {
    const res = await fetch('/api/builder/agents');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    builderState.agents = data.agents;
  } catch (e) {
    console.error('[builder] Failed to load agents:', e);
  }
}

export async function loadBuiltTools() {
  try {
    const res = await fetch('/api/builder/tools');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    builderState.tools = data.tools;
  } catch (e) {
    console.error('[builder] Failed to load tools:', e);
  }
}

export async function createSkill(input: { name: string; description?: string; emoji?: string }): Promise<string | null> {
  try {
    const res = await fetch('/api/builder/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    await loadBuiltSkills();
    return data.id;
  } catch (e) {
    console.error('[builder] Failed to create skill:', e);
    return null;
  }
}

export async function createAgent(input: { name: string; emoji?: string; description?: string; model?: string }): Promise<string | null> {
  try {
    const res = await fetch('/api/builder/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    await loadBuiltAgents();
    return data.id;
  } catch (e) {
    console.error('[builder] Failed to create agent:', e);
    return null;
  }
}
