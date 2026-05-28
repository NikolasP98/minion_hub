<script lang="ts">
    /**
     * HTML overlay layer that renders above the PixiJS canvas:
     *   - Speech bubbles
     *   - Conversation indicators between agent pairs
     *   - Thinking/typing indicators
     *
     * This is pure DOM markup — NOT on the Pixi ticker / Rapier physics hot
     * path. The render loop in the parent component never reaches into this
     * sub-tree.
     */
    import SpeechBubble from "../SpeechBubble.svelte";
    import ConversationIndicator from "../ConversationIndicator.svelte";
    import { workshopState } from "$lib/state/workshop/workshop.svelte";
    import { thinkingAgents } from "$lib/state/workshop/workshop-conversations.svelte";
    import type { SpeechBubbleEntry } from "./types";

    interface Props {
        speechBubbles: SpeechBubbleEntry[];
        worldToScreenAware: (worldX: number, worldY: number) => {
            x: number;
            y: number;
        };
        onRemoveBubble: (id: string) => void;
        onOpenConversation: (conversationId: string) => void;
    }

    let {
        speechBubbles,
        worldToScreenAware,
        onRemoveBubble,
        onOpenConversation,
    }: Props = $props();
</script>

<div class="absolute inset-0 pointer-events-none overflow-hidden z-20">
    {#each speechBubbles as bubble (bubble.id)}
        {@const agent = workshopState.agents[bubble.instanceId]}
        {#if agent}
            {@const screenPos = worldToScreenAware(
                agent.position.x,
                agent.position.y,
            )}
            <SpeechBubble
                message={bubble.message}
                agentName={bubble.agentName}
                screenX={screenPos.x}
                screenY={screenPos.y}
                onFaded={() => onRemoveBubble(bubble.id)}
            />
        {/if}
    {/each}

    <!-- Conversation indicators between agent pairs -->
    {#each Object.values(workshopState.conversations).filter((c) => c.status === "active") as conv (conv.id)}
        {#if conv.participantInstanceIds.length >= 2}
            {@const instA =
                workshopState.agents[conv.participantInstanceIds[0]]}
            {@const instB =
                workshopState.agents[conv.participantInstanceIds[1]]}
            {#if instA && instB}
                {@const midWorldX =
                    (instA.position.x + instB.position.x) / 2}
                {@const midWorldY =
                    Math.min(instA.position.y, instB.position.y) - 30}
                {@const screenPos = worldToScreenAware(
                    midWorldX,
                    midWorldY,
                )}
                <ConversationIndicator
                    x={screenPos.x}
                    y={screenPos.y}
                    type={conv.type}
                    onclick={() => onOpenConversation(conv.id)}
                />
            {/if}
        {/if}
    {/each}

    <!-- Thinking/typing indicators -->
    {#each Object.keys(thinkingAgents) as instanceId (instanceId)}
        {@const agent = workshopState.agents[instanceId]}
        {#if agent}
            {@const pos = worldToScreenAware(
                agent.position.x,
                agent.position.y,
            )}
            <div
                class="absolute pointer-events-none z-20 thinking-indicator"
                style="left: {pos.x}px; top: {pos.y -
                    55}px; transform: translateX(-50%);"
            >
                <div
                    class="flex items-center gap-0.5 px-2 py-1 rounded-full bg-bg2/80 backdrop-blur border border-border/50"
                >
                    <span
                        class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
                    ></span>
                    <span
                        class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
                        style="animation-delay: 0.2s"
                    ></span>
                    <span
                        class="thinking-dot w-1.5 h-1.5 rounded-full bg-accent"
                        style="animation-delay: 0.4s"
                    ></span>
                </div>
            </div>
        {/if}
    {/each}
</div>

<style>
    .thinking-dot {
        animation: thinking-bounce 1.4s infinite ease-in-out;
    }

    @keyframes thinking-bounce {
        0%,
        80%,
        100% {
            opacity: 0.25;
            transform: scale(0.8);
        }
        40% {
            opacity: 1;
            transform: scale(1.2);
        }
    }
</style>
