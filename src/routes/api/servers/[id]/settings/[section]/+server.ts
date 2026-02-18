import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getSettingsSection, upsertSettings } from '$lib/../server/db';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const value = await getSettingsSection(params.id!, params.section!);
    return json({ value });
  } catch {
    return json({ value: null });
  }
};

export const PUT: RequestHandler = async ({ params, request }) => {
  try {
    const body: unknown = await request.json();
    await upsertSettings(params.id!, params.section!, body);
    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
};
