<script lang="ts">
  import { gw } from '$lib/state/gateway-data.svelte';
  import { flowEditorState, setNodes } from '$lib/state/flow-editor.svelte';
  import type { FlowNode, AgentNodeData, PromptBoxData } from '$lib/state/flow-editor.svelte';
  import { Bot, Type } from 'lucide-svelte';

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function addAgentNode(agentId: string, label: string) {
    const node: FlowNode = {
      id: makeId(),
      type: 'agent',
      position: { x: 200 + Math.random() * 100, y: 100 + Math.random() * 100 },
      data: {
        agentId,
        label,
        defaultValues: {},
        contextRules: [],
        inputHandles: [{ id: 'in', label: 'input' }],
        outputHandles: [{ id: 'out', label: 'output' }],
        contextHandles: [{ id: 'ctx', label: 'context' }],
      } satisfies AgentNodeData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }

  function addPromptBox() {
    const node: FlowNode = {
      id: makeId(),
      type: 'promptBox',
      position: { x: 80 + Math.random() * 60, y: 100 + Math.random() * 100 },
      data: {
        label: 'Prompt',
        value: '',
      } satisfies PromptBoxData,
    };
    setNodes([...flowEditorState.nodes, node]);
  }
</script>

<aside class="w-56 shrink-0 bg-bg2 border-r border-border flex flex-col overflow-hidden">
  <!-- Header -->
  <div class="px-3 py-3 border-b border-border">
    <h2 class="text-xs font-semibold text-muted uppercase tracking-wide">Palette</h2>
  </div>

  <div class="flex-1 overflow-y-auto p-2 space-y-4">
    <!-- Inputs section -->
    <div>
      <p class="text-[10px] font-semibold text-muted/60 uppercase tracking-wide px-1 mb-1">
        Inputs
      </p>
      <button
        onclick={addPromptBox}
        class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-bg3 transition-colors group border border-transparent hover:border-border/60"
      >
        <div class="w-7 h-7 rounded-md bg-violet-500/20 flex items-center justify-center shrink-0">
          <Type size={14} class="text-violet-400" />
        </div>
        <div>
          <div class="text-xs font-medium text-foreground">Prompt Box</div>
          <div class="text-[10px] text-muted">Text input node</div>
        </div>
      </button>
    </div>

    <!-- Agents section -->
    <div>
      <p class="text-[10px] font-semibold text-muted/60 uppercase tracking-wide px-1 mb-1">
        Agents
      </p>

      {#if gw.agents.length === 0}
        <p class="text-xs text-muted/50 italic px-2 py-1">
          No agents connected. Ensure a gateway host is selected.
        </p>
      {:else}
        {#each gw.agents as agent (agent.id)}
          <button
            onclick={() => addAgentNode(agent.id, agent.name ?? agent.id)}
            class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-bg3 transition-colors group border border-transparent hover:border-border/60 mb-1"
          >
            <div
              class="w-7 h-7 rounded-md bg-indigo-500/20 flex items-center justify-center shrink-0 text-base"
            >
              {#if agent.emoji}
                {agent.emoji}
              {:else}
                <Bot size={14} class="text-indigo-400" />
              {/if}
            </div>
            <div class="min-w-0">
              <div class="text-xs font-medium text-foreground truncate">{agent.name ?? agent.id}</div>
              {#if agent.description}
                <div class="text-[10px] text-muted truncate">{agent.description}</div>
              {/if}
            </div>
          </button>
        {/each}
      {/if}
    </div>
  </div>
</aside>
