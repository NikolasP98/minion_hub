import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getCoreDb } from '$server/db/pg-client';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { listNotes, type Note } from '$server/services/notes.service';
import type { NotesCtx } from '$server/auth/notes-ctx';
import { NOTE_KINDS, type NoteKind, type NoteData, type TodoData, type EaselData } from '$lib/types/notes';

/**
 * First ~120 chars of a note's readable text, per kind. `note.data`'s runtime
 * shape is guaranteed by `note.kind` (parseNoteData validates them together in
 * notes.service) even though the `NoteDocument` union type doesn't encode that
 * correlation — hence the per-branch `as` casts rather than `in` narrowing.
 */
function previewOf(note: Note): string {
	if (note.kind === 'todo') {
		const data = note.data as TodoData;
		return data.items
			.map((i) => i.text)
			.filter(Boolean)
			.join(', ')
			.slice(0, 120);
	}
	if (note.kind === 'easel') {
		const data = note.data as EaselData;
		return data.items.length > 0 ? `${data.items.length} item(s)` : '';
	}
	const data = note.data as NoteData;
	const body = data.body.trim();
	if (body) return body.slice(0, 120);
	const blocks = data.blocks ?? [];
	const text = blocks
		.map((block) =>
			block.type === 'text'
				? block.md
				: block.type === 'todo'
					? block.items.map((i) => i.text).join(' ')
					: '',
		)
		.join(' ')
		.trim();
	return text.slice(0, 120);
}

/**
 * GET /api/gateway/query/notes?agentId=personal-<uuid>[&orgId=][&kind=][&q=][&limit=]
 *
 * Principal-scoped note listing (no RBAC module — same as note-create).
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const { principalId, orgId } = await resolveAssistantPrincipal(locals, url);
	const ctx: NotesCtx = { db: getCoreDb(), tenantId: orgId, userId: principalId };

	const kindParam = url.searchParams.get('kind');
	const kind = kindParam && (NOTE_KINDS as readonly string[]).includes(kindParam) ? (kindParam as NoteKind) : null;
	const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
	const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50) || 50));

	let all = await listNotes(ctx);
	if (kind) all = all.filter((n) => n.kind === kind);
	const withPreview = all.map((n) => ({
		id: n.id,
		kind: n.kind,
		title: n.title,
		preview: previewOf(n),
		updatedAt: n.updatedAt,
	}));
	const filtered = q
		? withPreview.filter(
				(n) => n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q),
			)
		: withPreview;

	return json({ notes: filtered.slice(0, limit) });
};
