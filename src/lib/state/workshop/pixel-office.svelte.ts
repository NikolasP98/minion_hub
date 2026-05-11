/**
 * Pixel Office State
 *
 * Manages state specific to the pixel art office view mode in the workshop.
 * Office layout, seat assignments, editor state, and pixel-specific settings.
 */

import type { OfficeLayout } from '$lib/workshop/pixel/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface PixelOfficeSettings {
  /** Whether the layout editor is active */
  editMode: boolean;
  /** Notification chime when agent needs attention */
  soundEnabled: boolean;
  /** Canvas zoom level (integer, 1-10) */
  zoomLevel: number;
}

export const pixelOfficeState = $state({
  /** Current office layout (loaded from static assets or localStorage) */
  layout: null as OfficeLayout | null,
  /** Agent instance ID → seat UID mapping */
  seatAssignments: {} as Record<string, string>,
  /** Pixel-specific settings */
  settings: {
    editMode: false,
    soundEnabled: false,
    zoomLevel: 2,
  } as PixelOfficeSettings,
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function pixelOfficeKey(hostId: string): string {
  return `workshop:autosave:${hostId}:pixelOffice`;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function autoSavePixelOffice(hostId: string | undefined): void {
  if (!hostId || typeof localStorage === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = {
        layout: pixelOfficeState.layout,
        seatAssignments: pixelOfficeState.seatAssignments,
        settings: pixelOfficeState.settings,
      };
      localStorage.setItem(pixelOfficeKey(hostId), JSON.stringify(data));
    } catch {
      /* ignore quota errors */
    }
  }, 300);
}

export function loadPixelOffice(hostId: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const raw = localStorage.getItem(pixelOfficeKey(hostId));
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.layout) pixelOfficeState.layout = data.layout;
    if (data.seatAssignments) pixelOfficeState.seatAssignments = data.seatAssignments;
    if (data.settings) {
      Object.assign(pixelOfficeState.settings, data.settings);
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Seat management
// ---------------------------------------------------------------------------

export function assignSeat(instanceId: string, seatUid: string): void {
  pixelOfficeState.seatAssignments[instanceId] = seatUid;
}

export function unassignSeat(instanceId: string): void {
  delete pixelOfficeState.seatAssignments[instanceId];
}

export function getSeatForAgent(instanceId: string): string | undefined {
  return pixelOfficeState.seatAssignments[instanceId];
}

// ---------------------------------------------------------------------------
// Layout management
// ---------------------------------------------------------------------------

export function setLayout(layout: OfficeLayout): void {
  pixelOfficeState.layout = layout;
}

export function toggleEditMode(): void {
  pixelOfficeState.settings.editMode = !pixelOfficeState.settings.editMode;
}

export function setZoomLevel(zoom: number): void {
  pixelOfficeState.settings.zoomLevel = Math.max(1, Math.min(10, Math.round(zoom)));
}
