import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	buildOwlCatalog,
	generateOwlCompose,
	type GenerateProgressEvent,
} from '$lib/server/service/ai-owl-service';
import { defaultOwlShell } from '$lib/email/owl/studio-server';
import { STARTERS } from '$lib/email/owl/starters';
import { getDesignSystemBundle, listOwlSectionComponents } from '$lib/server/service/design-system-service';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const teamId = requireTeamId(locals.teamId);

	let body: {
		name?: string;
		subject?: string;
		description?: string;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const templateName = String(body.name ?? 'Email').trim() || 'Email';
	const templateSubject = String(body.subject ?? '').trim() || templateName;
	const description = String(body.description ?? '').trim();
	if (!description) error(400, 'Description is required');

	const bundle = getDesignSystemBundle(teamId);
	// Prefer saved Owl sections; fall back to any component with html for legacy rows.
	const owlSections = listOwlSectionComponents(teamId);
	const designForCatalog =
		owlSections.length > 0
			? owlSections
			: bundle.components.filter((c) => c.html?.trim());
	const catalog = buildOwlCatalog(
		STARTERS.map((s) => ({
			key: s.key,
			name: s.name,
			description: s.description,
			role: s.role,
			html: s.html,
		})),
		designForCatalog.map((c) => ({
			id: c.id,
			name: c.name,
			description: c.description,
			html: c.html ?? '',
		})),
	);

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				const result = await generateOwlCompose({
					teamId,
					templateName,
					templateSubject,
					description,
					shellHtml: defaultOwlShell(),
					catalog,
					signal: request.signal,
					onProgress: (event: GenerateProgressEvent) => {
						send(event);
					},
				});
				send({
					stage: 'done',
					message: 'Template ready.',
					content: {
						doc: result.doc,
						subject: result.subject,
						preheader: result.preheader,
						model: result.model,
					},
				});
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					send({ stage: 'cancelled', message: 'Generation stopped.' });
				} else {
					send({
						stage: 'error',
						message: e instanceof Error ? e.message : 'Compose failed',
					});
				}
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
		},
	});
};
