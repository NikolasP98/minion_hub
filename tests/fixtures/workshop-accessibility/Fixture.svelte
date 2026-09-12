<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '@minion-stack/ui';
  import Controls from '$lib/components/workshop/_workshop-canvas/WorkshopAgentControls.svelte';
  import TaskPromptDialog from '$lib/components/workshop/_workshop-canvas/TaskPromptDialog.svelte';
  import { startGameLoop } from '$lib/workshop/pixel/game-loop';
  import { OfficeState } from '$lib/workshop/pixel/office-state';
  let canvas: HTMLCanvasElement;
  let selectedId = $state<string | null>(null);
  let task = $state<string | null>(null);
  let value = $state('');
  let submitted = $state('');
  let online = $state(true);
  let liveVersion = 0;
  onMount(() => {
    const office = new OfficeState();
    office.addAgent(1, 0);
    let updates = 0;
    let syncs = 0;
    let renders = 0;
    let stopped = false;
    let liveSeen = 0;
    const stopLoop = startGameLoop(canvas, {
      sync: () => { syncs++; liveSeen = liveVersion; },
      update: (dt, reducedMotion) => {
        office.update(dt, reducedMotion);
        if (!reducedMotion) updates++;
      },
      render: (ctx) => { renders++; ctx.clearRect(0, 0, 300, 100); ctx.fillRect(updates % 250, 30, 20, 20); },
    });
    const stop = () => { stopped = true; stopLoop(); };
    Object.assign(window, { __workshop: {
      snapshot: () => ({ updates, syncs, renders, liveSeen, stopped,
        characters: office.getCharacters().map(ch => ({ id: ch.id, effect: ch.matrixEffect,
          bubble: ch.bubbleType, bubbleTimer: ch.bubbleTimer, x: ch.x, y: ch.y })),
      }),
      addAgent: (id: number) => office.addAgent(id, 0),
      removeAgent: (id: number) => office.removeAgent(id),
      waiting: (id: number) => office.showWaitingBubble(id),
      updateLive: () => { liveVersion++; }, stop,
    }});
    return stop;
  });
</script>
<div class="workshop-fixture">
  <h1>Workshop accessibility fixture</h1>
  <canvas bind:this={canvas} width="300" height="100" aria-label="Pixel motion sample"></canvas>
  <Controls agents={[{id:'agent-a',name:'Ada'},{id:'agent-b',name:'Grace'}]} {selectedId}
    connected={online} onselect={(id) => selectedId=id} onassign={(id) => { task=id; value=''; }} />
  <Button onclick={() => online=!online}>Toggle connection</Button>
  <output aria-label="Selected agent">{selectedId ?? 'none'}</output>
  <output aria-label="Submitted task">{submitted}</output>
</div>
{#if task}
  <TaskPromptDialog mode="assign" agentName={task==='agent-a'?'Ada':'Grace'} {value}
    onValueChange={(next) => value=next} onCancel={() => task=null}
    onSubmit={() => {submitted=`${task}: ${value}`;task=null;}} />
{/if}
<style>
  .workshop-fixture { position: relative; min-height: 100dvh; padding: var(--space-4); }
  output { display: block; }
</style>
