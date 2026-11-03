// Client helper for the AI Tab-autofill endpoint.
//
// note → a short paragraph continuation; todo → a list of suggested items.
// Used by the Tiptap autofill extension (note) and the todo ghost-suggester.

import { isPremiumResponse } from '$lib/access/premium';

/** Throws on a failed response; a premium_required 403 keeps that code in `details` (spec 043). */
async function assertOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const details = (await isPremiumResponse(res)) ? { code: 'premium_required' } : undefined;
  throw Object.assign(new Error(`${what} failed: ${res.status}`), { details });
}

export interface NoteAutocompleteResult {
  suggestion: string;
}
export interface TodoAutocompleteResult {
  items: string[];
}
export type AutocompleteResult = NoteAutocompleteResult | TodoAutocompleteResult;

export interface AutocompleteRequest {
  kind: 'note' | 'todo';
  context: string;
}

export async function fetchAutocomplete(
  req: AutocompleteRequest,
  signal?: AbortSignal,
): Promise<AutocompleteResult> {
  const res = await fetch('/api/notes/autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  await assertOk(res, 'autocomplete');
  return (await res.json()) as AutocompleteResult;
}

/**
 * Clean up raw dictated/transcribed text (punctuation, casing, STT slips) without
 * changing meaning. Used by the note transcription buffer's "Polish" action.
 */
export async function polishTranscript(
  text: string,
  intent?: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/notes/polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, intent }),
    signal,
  });
  await assertOk(res, 'polish');
  const { text: out } = (await res.json()) as { text: string };
  return out;
}

// ── Note "Polish": AI-suggested titles for a note + its blocks ──

export type NotePolishIntent = 'meeting' | 'short' | 'long' | 'formal' | 'actions';

export const NOTE_POLISH_INTENTS: { id: NotePolishIntent; label: string }[] = [
  { id: 'meeting', label: 'Meeting' },
  { id: 'short', label: 'Short' },
  { id: 'long', label: 'Long' },
  { id: 'formal', label: 'Formal' },
  { id: 'actions', label: 'Actions' },
];

export interface RefineBlockInput {
  id: string;
  type: 'text' | 'todo' | 'easel';
  title?: string;
  content?: string;
}
export interface RefineResult {
  title: string;
  blocks: { id: string; title: string }[];
  textBlocks?: { id: string; body: string }[];
}

/** Ask the model for a note title + titles for its embedded blocks. */
export async function refineNote(
  input: { intent: NotePolishIntent; title?: string; blocks: RefineBlockInput[] },
  signal?: AbortSignal,
): Promise<RefineResult> {
  const res = await fetch('/api/notes/refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  // Spec 043: a premium_required answer is "nothing to change", so runPolish shows no error.
  if (await isPremiumResponse(res)) return { title: '', blocks: [], textBlocks: [] };
  await assertOk(res, 'refine');
  return (await res.json()) as RefineResult;
}
