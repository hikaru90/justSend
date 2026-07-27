import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { renderEmailHtml } from '$lib/email-editor/renderer';
import { parseBody } from '$lib/server/api/validate';

const schema = z.object({
	content: z.string(),
	html: z.string().optional(),
	variables: z.record(z.string(), z.string()).optional()
});

export const POST: RequestHandler = async ({ request }) => {
	const { content, html, variables } = await parseBody(request, schema);
	const rendered = renderEmailHtml(content, html ?? null, variables);
	return json({ html: rendered });
};
