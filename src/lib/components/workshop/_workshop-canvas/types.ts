/**
 * Shared type definitions for WorkshopCanvas overlay state.
 * Extracted from WorkshopCanvas.svelte — render-loop types intentionally
 * NOT extracted (they remain inline to keep the hot path local).
 */

import type { ElementType } from "$lib/state/workshop/workshop.svelte";

export interface ContextMenuState {
    instanceId: string;
    agentName: string;
    x: number;
    y: number;
}

export interface RelationshipPromptState {
    fromId: string;
    toId: string;
    fromName: string;
    toName: string;
    x: number;
    y: number;
}

export interface SpeechBubbleEntry {
    id: string;
    message: string;
    agentName: string;
    instanceId: string;
}

export interface TaskPromptDialogState {
    instanceId: string;
    /** Set when starting a conversation with another agent. */
    targetInstanceId?: string;
    agentName: string;
    mode: "assign" | "conversation";
}

export interface ActiveOverlayState {
    elementId: string;
    type: ElementType;
}

export interface ElementContextMenuState {
    instanceId: string;
    label: string;
    x: number;
    y: number;
}
