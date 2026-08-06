import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	generateOwlScaffold,
	type OwlAiResult,
	type GenerateProgressEvent,
} from '$lib/server/service/ai-owl-service';
import { parseOwlDoc } from '$lib/email/owl/studio';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const teamId = requireTeamId(locals.teamId);

	let body: { doc?: string; prompt?: string; sectionId?: string };
	try {
		body = (await request.json()) as { doc?: string; prompt?: string; sectionId?: string };
	} catch {
		error(400, 'Invalid JSON body');
	}

	const doc = parseOwlDoc(body.doc);
	if (!doc) error(400, 'Invalid owl document');

	const prompt = String(body.prompt ?? '');
	const sectionId = String(body.sectionId ?? '') || undefined;
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				const result: OwlAiResult = await generateOwlScaffold({
					teamId,
					doc,
					prompt,
					sectionId,
					assetBaseUrl: url.origin,
					signal: request.signal,
					onProgress: (event: GenerateProgressEvent) => {
						send(event);
					},
				});
				send({
					stage: 'done',
					message: 'Copy ready.',
					content: result,
				});
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					send({ stage: 'cancelled', message: 'Generation stopped.' });
				} else {
					send({
						stage: 'error',
						message: e instanceof Error ? e.message : 'Generation failed',
					});
				}
			} finally {
				controller.close();
			}
		},
		cancel() {
			// Client disconnected — request.signal already aborted.
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
