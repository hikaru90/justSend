import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	generateScaffold,
	type GenerateProgressEvent
} from '$lib/server/service/ai-template-service';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId ?? undefined;

	let body: { prompt?: string };
	try {
		body = (await request.json()) as { prompt?: string };
	} catch {
		error(400, 'Invalid JSON body');
	}

	const prompt = String(body.prompt ?? '');
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: Record<string, unknown>) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				await generateScaffold({
					teamId,
					domainId,
					templateId: params.id,
					prompt,
					assetBaseUrl: url.origin,
					signal: request.signal,
					onProgress: (event: GenerateProgressEvent) => {
						send(event);
					}
				});
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					send({ stage: 'cancelled', message: 'Generation stopped.' });
				} else {
					send({
						stage: 'error',
						message: e instanceof Error ? e.message : 'Scaffold failed'
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
