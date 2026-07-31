import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	inferDesignSystemFromUrl,
	type InferProgressEvent
} from '$lib/server/service/design-infer-service';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const teamId = requireTeamId(locals.teamId);

	let body: { url?: string };
	try {
		body = (await request.json()) as { url?: string };
	} catch {
		error(400, 'Invalid JSON body');
	}

	const rawUrl = String(body.url ?? '').trim();
	if (!rawUrl) error(400, 'URL is required');

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				await inferDesignSystemFromUrl({
					teamId,
					rawUrl,
					signal: request.signal,
					onProgress: (event: InferProgressEvent) => {
						send(event);
					}
				});
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					send({ stage: 'cancelled', message: 'Inference stopped.' });
				} else {
					send({
						stage: 'error',
						message: e instanceof Error ? e.message : 'Inference failed'
					});
				}
			} finally {
				controller.close();
			}
		},
		cancel() {
			// Client disconnected — request.signal already aborted.
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
