import { error, json } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { renderDeliveredEmailHtml } from '$lib/email-builder/render-delivered';
import type { TEditorConfiguration } from '$lib/email-builder/types';
import type { RequestHandler } from './$types';

/**
 * Server-side MJML compile of an EmailBuilder document — the live preview for
 * the design-system editor (canvas keeps the client render; the Preview and
 * HTML output tabs show this delivery html).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireTeamId(locals.teamId);

	let body: { document?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const document = body?.document as TEditorConfiguration | null;
	if (!document || typeof document !== 'object') error(400, 'Missing document');

	try {
		const html = await renderDeliveredEmailHtml(document);
		return json({ html });
	} catch (e) {
		error(400, e instanceof Error ? e.message : 'Compile failed');
	}
};
