// Skill-editor state — facade.
//
// The implementation was split into cohesive modules (this file was ~1300 lines):
//  - skill-editor.types.ts            — shared interfaces
//  - skill-editor.core.svelte.ts      — state, derived getters, load/save/publish,
//                                        AI build, ghost suggestions, chapter/condition CRUD
//  - skill-editor.dry-run.svelte.ts   — dry-run execution + suggested test prompts
//  - skill-editor.proposals.svelte.ts — staged AI proposal accept/reject (AI-03)
//
// Dependency direction is one-way (dry-run/proposals → core → types), so this
// facade re-export is acyclic. Import paths for consumers are unchanged.

export * from './skill-editor.types';
export * from './skill-editor.core.svelte';
export * from './skill-editor.dry-run.svelte';
export * from './skill-editor.proposals.svelte';
