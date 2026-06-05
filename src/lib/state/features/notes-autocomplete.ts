// Client helper for the AI Tab-autofill endpoint.
//
// note → a short paragraph continuation; todo → a list of suggested items.
// Used by the Tiptap autofill extension (note) and the todo ghost-suggester.

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
  if (!res.ok) throw new Error(`autocomplete failed: ${res.status}`);
  return (await res.json()) as AutocompleteResult;
}
