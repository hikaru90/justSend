import { json } from '@sveltejs/kit';
import type { z } from 'zod';

/** @deprecated Prefer parseBody — kept for existing call sites */
export async function parseJson<T extends z.ZodType>(
	request: Request,
	schema: T,
): Promise<z.infer<T>> {
	return parseBody(request, schema);
}

export async function parseBody<T extends z.ZodType>(
	request: Request,
	schema: T,
): Promise<z.infer<T>> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw json({ error: { message: 'Invalid JSON body', code: 'BAD_REQUEST' } }, { status: 400 });
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		throw json(
			{
				error: {
					message: 'Validation failed',
					code: 'VALIDATION_ERROR',
					details: parsed.error.flatten(),
				},
			},
			{ status: 400 },
		);
	}
	return parsed.data;
}
