import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import {
	editHtmlWithPiStream,
	isPiConfigured,
	type PiEditStreamEvent
} from '$lib/server/service/pi-service';
import {
	getComponent,
	listComponents,
	updateComponentSource
} from '$lib/server/service/template-component-service';
import { validateComponentSource } from '$lib/server/service/template-compile-service';
import { getTemplate } from '$lib/server/service/template-service';
import type { RequestHandler } from './$types';

function sse(data: Record<string, unknown>): string {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, locals, params }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId ?? undefined;

	if (!isPiConfigured()) {
		error(400, 'Pi is not configured (OPENROUTER_API_KEY)');
	}

	let body: { componentId?: string; instruction?: string; source?: string };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const instruction = String(body.instruction ?? '').trim();
	if (!instruction) {
		error(400, 'Describe the change for Pi');
	}

	const template = getTemplate(params.id, teamId, domainId);
	const components = listComponents(template.id, teamId, domainId);
	if (components.length === 0) {
		error(400, 'No Svelte components to edit — generate the template first');
	}

	const componentId = String(body.componentId ?? '').trim() || components.find((c) => c.kind === 'root')?.id || components[0].id;
	const component = getComponent(componentId, template.id, teamId, domainId);
	const source = String(body.source ?? '') || component.source;
	const bundle = getDesignSystemBundle(teamId);
	const encoder = new TextEncoder();
	const filename = `${component.name}.svelte`;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (payload: PiEditStreamEvent) => {
				controller.enqueue(encoder.encode(sse(payload)));
			};

			try {
				const edited = await editHtmlWithPiStream({
					html: source,
					filename,
					instruction: [
						instruction,
						'',
						'This is a Svelte 5 email component. Keep <script> limited to relative .svelte imports and $props() only.',
						'Use table + tbody layout and bind element values via props — do not hardcode them.'
					].join('\n'),
					signal: request.signal,
					context: {
						kind: 'component',
						name: component.name,
						subject: template.subject
					},
					// Edit path: skip design.md (generator already baked brand into the tree).
					// Keep compact component HTML refs only when the edit needs pattern matching.
					design: {
						components: bundle.components.map((c) => ({
							name: c.name,
							description: c.description,
							html: c.html
						}))
					},
					onEvent: send
				});

				validateComponentSource(component.name, edited);
				updateComponentSource(component.id, template.id, teamId, domainId, edited);
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
