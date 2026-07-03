import { error } from '@sveltejs/kit';
import type { z } from 'zod';

/** Parse+validate a JSON request body. 400 with readable issues on failure. */
export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const result = schema.safeParse(raw);
	if (!result.success) {
		const detail = result.error.issues
			.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
			.join('; ');
		throw error(400, `invalid body: ${detail}`);
	}
	return result.data;
}
