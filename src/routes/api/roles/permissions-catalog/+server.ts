import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { groupPermissions } from '$lib/permissions';

export const GET: RequestHandler = async () => json({ catalog: groupPermissions() });
