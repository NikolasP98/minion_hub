import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreDb } from '$server/db/pg-client';
import { parseBody } from '$server/api/validate';
import { resolveAssistantPrincipal } from '$server/auth/assistant-principal';
import { createNote } from '$server/services/notes.service';
import type { NotesCtx } from '$server/auth/notes-ctx';

const bodySchema = z.object({
	confirm: z.literal(true),
	kind: z.enum(['note', 'todo', 'easel']).default('note'),
	title: z.string().max(500).optional(),
	content: z.string().max(20_000).optional(),
	todos: z.array(z.object({ text: z.string().min(1).max(2000), done: z.boolean().optional() })).optional(),
	color: z.enum(['default', 'amber', 'rose', 'sky', 'violet', 'green']).optional(),
});

/**
 * POST /api/gateway/actions/note-create?agentId=personal-<uuid>[&orgId=]
 * body: { kind:'note'|'todo'|'easel', title?, content?, todos?:[{text,done?}], color?, confirm:true }
 *
 * Notes are principal-scoped personal data with no RBAC module (mirrors
 * email-ledger/insight: `resolveAssistantPrincipal` directly, no capability
 * gate) — the agent may only ever create notes owned by the user it acts for.
 * `data` is built into the exact shape `createNote`/`parseNoteData` (and the
 * NotesPanel UI) expect per kind, so notes created by the agent render
 * correctly in /home's NotesPanel:
 *   - note:  { body: content ?? '', attachments: [] }
 *   - todo:  { items: todos.map(t => ({ id, text, done })), attachments: [] }
 *   - easel: { items: [] } (empty canvas — the agent doesn't draw)
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { principalId, orgId } = await resolveAssistantPrincipal(locals, url);
	const b = await parseBody(request, bodySchema);

	const ctx: NotesCtx = { db: getCoreDb(), tenantId: orgId, userId: principalId };

	let data: unknown;
	if (b.kind === 'todo') {
		data = {
			items: (b.todos ?? []).map((t) => ({ id: crypto.randomUUID(), text: t.text, done: t.done ?? false })),
			attachments: [],
		};
	} else if (b.kind === 'easel') {
		data = { items: [] };
	} else {
		data = { body: b.content ?? '', attachments: [] };
	}

	const note = await createNote(ctx, {
		kind: b.kind,
		title: b.title ?? '',
		color: b.color,
		data,
	});
	return json({ ok: true, noteId: note.id }, { status: 201 });
};
