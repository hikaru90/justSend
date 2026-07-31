import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	editHtmlWithPiStream,
	isPiConfigured,
	type PiEditStreamEvent
} from '$lib/server/service/pi-service';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const teamId = requireTeamId(locals.teamId);

	if (!isPiConfigured()) {
		error(400, 'Pi is not configured (OPENROUTER_API_KEY)');
	}

	let body: {
		instruction?: string;
		html?: string;
		name?: string;
		description?: string;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const instruction = String(body.instruction ?? '').trim();
	if (!instruction) {
		error(400, 'Describe the change for Pi');
	}

	const html = String(body.html ?? '');
	const name = String(body.name ?? '').trim();
	const description = String(body.description ?? '').trim() || null;

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: PiEditStreamEvent) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				const edited = await editHtmlWithPiStream({
					html,
					instruction,
					teamId,
					assetBaseUrl: url.origin,
					context: { kind: 'component', name, description },
					signal: request.signal,
					onEvent: send
				});

				send({ type: 'done', html: edited, message: 'Edit complete.' });
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					send({ type: 'cancelled', message: 'Edit cancelled.' });
				} else {
					send({
						type: 'error',
						message: e instanceof Error ? e.message : 'Pi edit failed'
					});
				}
			} finally {
				controller.close();
			}
		},
		cancel() {
			// Client disconnected / aborted — request.signal already aborted.
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
