import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { getSettings } from '$lib/../server/db';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const settings = await getSettings(params.id!);
    return json({ settings });
  } catch {
    return json({ settings: {} });
  }
};
