import { VISEMES } from 'wawa-lipsync';

/** Mouth shape: 0 closed → 1 open vertically; 0 pursed → 1 wide. */
export type MouthShape = { open: number; width: number };

export const REST_MOUTH: MouthShape = { open: 0, width: 0.3 };

/**
 * wawa-lipsync emits Oculus-15 visemes from live audio. Map each to an
 * {open,width} shape — values follow OpenHuman's viseme shape model
 * (aa/E/I/O/U from their VISEMES table; consonants tuned to its in-betweens).
 *
 * Ported verbatim from the meeting-agent demo
 * (.claude/worktrees/meeting-agent-demo/meeting-agent/src/mascot/visemeMap.ts).
 */
export const VISEME_TO_MOUTH: Record<string, MouthShape> = {
  [VISEMES.sil]: { open: 0, width: 0.3 },
  [VISEMES.PP]: { open: 0, width: 0.4 },
  [VISEMES.FF]: { open: 0.15, width: 0.55 },
  [VISEMES.TH]: { open: 0.22, width: 0.5 },
  [VISEMES.DD]: { open: 0.3, width: 0.5 },
  [VISEMES.kk]: { open: 0.3, width: 0.5 },
  [VISEMES.CH]: { open: 0.2, width: 0.42 },
  [VISEMES.SS]: { open: 0.16, width: 0.55 },
  [VISEMES.nn]: { open: 0.2, width: 0.45 },
  [VISEMES.RR]: { open: 0.32, width: 0.35 },
  [VISEMES.aa]: { open: 0.95, width: 0.6 },
  [VISEMES.E]: { open: 0.45, width: 1.0 },
  [VISEMES.I]: { open: 0.32, width: 0.85 },
  [VISEMES.O]: { open: 0.78, width: 0.22 },
  [VISEMES.U]: { open: 0.4, width: 0.08 },
};

export function visemeToMouth(v: string): MouthShape {
  return VISEME_TO_MOUTH[v] ?? REST_MOUTH;
}

export type AgentVoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';
