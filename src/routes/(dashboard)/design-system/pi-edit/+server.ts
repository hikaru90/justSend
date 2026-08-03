import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { env } from '$lib/server/env';
import {
	disposePiSession,
	editComponentTreeWithPiStream,
	isPiConfigured,
	type PiEditStreamEvent,
} from '$lib/server/service/pi-service';
import type { ComponentSlot, TEditorConfiguration } from '$lib/email-builder/types';
import { EMPTY_DOCUMENT } from '$lib/email-builder/types';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const teamId = requireTeamId(locals.teamId);

	if (!isPiConfigured()) {
		error(400, 'Pi is not configured (OPENROUTER_API_KEY)');
	}

	let body: {
		instruction?: string;
		document?: TEditorConfiguration;
		slots?: ComponentSlot[];
		name?: string;
		description?: string;
		mode?: string;
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

	const document =
		body.document && typeof body.document === 'object' && body.document.root
			? body.document
			: EMPTY_DOCUMENT;
	const slots = Array.isArray(body.slots) ? body.slots : [];
	const name = String(body.name ?? '').trim();
	const description = String(body.description ?? '').trim() || null;
	const mode = body.mode;
	const assetBaseUrl = env.HOST_URL.replace(/\/$/, '');

	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: PiEditStreamEvent) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				const edited = await editComponentTreeWithPiStream({
					teamId,
					instruction,
					document,
					slots,
					name,
					description,
					mode,
					assetBaseUrl,
					signal: request.signal,
					onEvent: send,
				});

				send({
					type: 'done',
					document: edited.document,
					slots: edited.slots,
					mode: edited.mode,
					message: 'Edit complete.',
				});
			} catch (e) {
				if (e instanceof Error && e.name === 'AbortError') {
					send({ type: 'cancelled', message: 'Edit cancelled.' });
				} else {
					send({
						type: 'error',
						message: e instanceof Error ? e.message : 'Pi edit failed',
					});
				}
			} finally {
				controller.close();
			}
		},
		cancel() {
			// Client disconnected / aborted — request.signal already aborted.
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

/** End a multi-turn Pi edit session (modal close / cancel). Legacy no-op-safe cleanup. */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	requireTeamId(locals.teamId);

	if (!isPiConfigured()) {
		error(400, 'Pi is not configured (OPENROUTER_API_KEY)');
	}

	let body: { sessionId?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const sessionId = String(body.sessionId ?? '').trim();
	if (sessionId) disposePiSession(sessionId);
	return new Response(null, { status: 204 });
};
