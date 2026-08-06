import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { env } from '$lib/server/env';
import { compileOwlDoc, mergeEditedHtmlIntoOwlDoc } from '$lib/email/owl/studio-server';
import { parseDesignTokenMap } from '$lib/design/extractTokens';
import { parseOwlDoc, serializeOwlDoc, type OwlDoc } from '$lib/email/owl/studio';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import {
	disposePiSession,
	editHtmlWithPiStream,
	isPiConfigured,
	type PiEditStreamEvent,
} from '$lib/server/service/pi-service';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

function designTokensForTeam(teamId: number): Record<string, string> {
	const bundle = getDesignSystemBundle(teamId);
	return parseDesignTokenMap(bundle.system?.designMd ?? '');
}

const OWL_PRESERVE_RULE =
	'Preserve every data-owl-component and data-owl-role="section" marker on section root elements so the studio can split the email back into sections.';

export const POST: RequestHandler = async ({ request, locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);

	if (!isPiConfigured()) {
		error(400, 'Pi is not configured (OPENROUTER_API_KEY)');
	}

	let body: {
		doc?: string;
		instruction?: string;
		sessionId?: string;
		keepSession?: boolean;
		name?: string;
		subject?: string;
		description?: string;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const instruction = String(body.instruction ?? '').trim();
	if (!instruction) error(400, 'Describe the change for Pi');

	const doc = parseOwlDoc(body.doc);
	if (!doc) error(400, 'Invalid owl document');

	const sessionId = String(body.sessionId ?? '').trim() || undefined;
	const keepSession = body.keepSession !== false;
	const templateName = String(body.name ?? 'Email').trim() || 'Email';
	const templateSubject = String(body.subject ?? '').trim();
	const templateDescription = String(body.description ?? '').trim() || null;

	const compiled = compileOwlDoc(doc, {
		origin: url.origin,
		tokens: designTokensForTeam(teamId),
	});

	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: PiEditStreamEvent & { doc?: OwlDoc; sessionId?: string }) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				const result = await editHtmlWithPiStream({
					teamId,
					html: compiled.html,
					instruction: `${instruction}\n\n${OWL_PRESERVE_RULE}`,
					mode: doc.sections.length === 0 ? 'create' : 'edit',
					assetBaseUrl: env.HOST_URL.replace(/\/$/, ''),
					filename: 'email.html',
					context: {
						kind: 'template',
						name: templateName,
						description: templateDescription,
						subject: templateSubject || templateName,
					},
					sessionId,
					keepSession,
					signal: request.signal,
					onEvent: (event) => send(event),
				});

				const merged = mergeEditedHtmlIntoOwlDoc(doc, result.html);
				send({
					type: 'done',
					message: 'Edit applied to the template.',
					doc: merged,
					sessionId: result.sessionId,
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
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
		},
	});
};

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
