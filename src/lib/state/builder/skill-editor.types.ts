// Shared types for the skill-editor state modules
// (split out of skill-editor.svelte.ts so core / dry-run / proposals can share them).

export interface ChapterEntry {
  id: string;
  type?: string;
  name: string;
  description: string;
  guide: string;
  context: string;
  outputDef: string;
  conditionText?: string;
  positionX: number;
  positionY: number;
}

export interface StagedChapter {
  tempId: string;
  type: string;
  name: string;
  description: string;
  guide: string;
  context: string;
  outputDef: string;
  conditionText?: string;
  toolIds: string[];
  positionX: number;
  positionY: number;
}

export interface StagedEdge {
  fromTempId: string;
  toTempId: string;
  label: string | null;
}

export interface StagedProposal {
  chapters: StagedChapter[];
  edges: StagedEdge[];
}

export interface SuggestedPrompt {
  text: string;
  label: string;
}

export interface DryRunChapterResult {
  chapterId: string;
  chapterName: string;
  output: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  error?: string;
}

export interface DryRunAnalysisDimension {
  name: string;
  score: number;
  verdict: 'pass' | 'warn' | 'fail';
  details: string;
}

export interface DryRunAnalysis {
  overallScore: number;
  dimensions: DryRunAnalysisDimension[];
  recommendations: string[];
}

export interface DryRunState {
  running: boolean;
  prompt: string;
  results: DryRunChapterResult[];
  totalDurationMs: number;
  totalTokens: number;
  analysis: DryRunAnalysis | null;
  analyzing: boolean;
}
