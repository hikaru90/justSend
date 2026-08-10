import { beforeEach, describe, expect, it } from 'vitest';
import { emptyOwlDoc, serializeOwlDoc } from '$lib/email/owl/studio';
import { getFlow } from '$lib/server/service/flow-service';
import { resetDb } from '../src/tests/helpers/db';
import { createApiKey, createDomain, createTeam } from '../src/tests/helpers/factories';
import { createHandlers } from './handlers';
import { createOwleryMcpServer, resolveScopeFromEnv } from './server';

const TEST_SHELL = `<!DOCTYPE html><html><head></head><body>
<table data-owl-role="shell"><tr><td data-owl-slot="sections"></td></tr></table>
</body></html>`;

beforeEach(() => resetDb());

function parseContent(result: { content: Array<{ type: string; text: string }>; isError?: boolean }) {
	expect(result.content[0]?.type).toBe('text');
	return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

describe('owlery MCP handlers', () => {
	async function setup() {
		const team = createTeam();
		const domain = createDomain(team.id, { name: 'mail.example.com', status: 'SUCCESS' });
		const apiKey = await createApiKey(team.id, { permission: 'FULL' });
		const handlers = createHandlers({ teamId: team.id, domainId: domain.id });
		return { team, domain, apiKey, handlers };
	}

	it('resolves team from OWLERY_API_KEY and optional OWLERY_DOMAIN_ID', async () => {
		const team = createTeam();
		const domain = createDomain(team.id);
		const key = await createApiKey(team.id);
		const scope = await resolveScopeFromEnv({
			OWLERY_API_KEY: key,
			OWLERY_DOMAIN_ID: String(domain.id),
		});
		expect(scope).toEqual({ teamId: team.id, domainId: domain.id });
	});

	it('uses domain-scoped API key when OWLERY_DOMAIN_ID is unset', async () => {
		const team = createTeam();
		const domain = createDomain(team.id);
		const key = await createApiKey(team.id, { domainId: domain.id });
		const scope = await resolveScopeFromEnv({ OWLERY_API_KEY: key });
		expect(scope).toEqual({ teamId: team.id, domainId: domain.id });
	});

	it('rejects missing or invalid API keys', async () => {
		await expect(resolveScopeFromEnv({})).rejects.toThrow('OWLERY_API_KEY is required');
		await expect(resolveScopeFromEnv({ OWLERY_API_KEY: 'us_bad_token' })).rejects.toThrow(
			'Invalid OWLERY_API_KEY',
		);
	});

	it('registers all compose tools and never exposes activate/send names', () => {
		const server = createOwleryMcpServer({ teamId: 1, domainId: 1 });
		const tools = Object.keys(
			(
				server as unknown as {
					_registeredTools: Record<string, unknown>;
				}
			)._registeredTools,
		).sort();

		expect(tools).toEqual(
			[
				'compile_template_preview',
				'create_flow',
				'create_template',
				'delete_flow',
				'delete_template',
				'describe_owl_doc',
				'get_flow',
				'get_template',
				'list_flows',
				'list_templates',
				'update_flow',
				'update_template',
			].sort(),
		);

		for (const banned of [
			'activate_flow',
			'pause_flow',
			'send_email',
			'send_preview',
			'queue_email',
		]) {
			expect(tools).not.toContain(banned);
		}
	});

	it('templates CRUD + compile preview', async () => {
		const { handlers } = await setup();
		const content = serializeOwlDoc(emptyOwlDoc(TEST_SHELL, 'Pre'));

		const created = parseContent(
			await handlers.create_template({
				name: 'Welcome',
				subject: 'Hi {{firstName}}',
				content,
				tags: ['onboarding'],
			}),
		);
		expect(created.name).toBe('Welcome');
		expect(created.id).toBeTruthy();

		const listed = parseContent(await handlers.list_templates());
		expect((listed.templates as unknown[]).length).toBe(1);

		const got = parseContent(await handlers.get_template({ id: created.id as string }));
		expect(got.content).toBe(content);

		const updated = parseContent(
			await handlers.update_template({
				id: created.id as string,
				name: 'Welcome v2',
				subject: 'Hello',
			}),
		);
		expect(updated.name).toBe('Welcome v2');
		expect(updated.subject).toBe('Hello');

		const preview = parseContent(
			await handlers.compile_template_preview({ id: created.id as string }),
		);
		expect(preview.html).toEqual(expect.any(String));
		expect(String(preview.html).length).toBeGreaterThan(0);
		expect(preview.note).toMatch(/not sent/i);

		const deleted = parseContent(
			await handlers.delete_template({ id: created.id as string }),
		);
		expect(deleted.deleted).toBe(true);

		const after = parseContent(await handlers.list_templates());
		expect(after.templates).toEqual([]);
	});

	it('rejects non-OwlDoc content with a format guide', async () => {
		const { handlers } = await setup();
		const guide = parseContent(await handlers.describe_owl_doc());
		expect(guide.format).toBe('OwlDoc');
		expect(guide.example).toMatchObject({ owl: 'v1' });

		const badCreate = parseContent(
			await handlers.create_template({
				name: 'Bad',
				content: '<mjml><mj-body>nope</mj-body></mjml>',
			}),
		);
		expect(badCreate.error).toMatch(/Invalid OwlDoc/i);
		expect(badCreate.hint).toEqual(expect.stringContaining('owl": "v1"'));
		expect(badCreate.example).toMatchObject({ owl: 'v1' });

		const ok = parseContent(
			await handlers.create_template({
				name: 'Ok',
				content: serializeOwlDoc(emptyOwlDoc(TEST_SHELL, 'Pre')),
			}),
		);
		const badUpdate = parseContent(
			await handlers.update_template({
				id: ok.id as string,
				content: { root: { type: 'EmailLayout' } },
			}),
		);
		expect(badUpdate.error).toMatch(/Invalid OwlDoc/i);
	});

	it('flows CRUD without ever changing status via update_flow', async () => {
		const { team, domain, handlers } = await setup();

		const created = parseContent(
			await handlers.create_flow({
				name: 'Onboarding',
				triggerConfig: { contactBookId: 'book-1' },
			}),
		);
		expect(created.status).toBe('draft');
		expect(created.name).toBe('Onboarding');

		const listed = parseContent(await handlers.list_flows());
		expect((listed.flows as unknown[]).length).toBe(1);

		const graph = created.graph as {
			nodes: Array<{
				id: string;
				type?: string;
				position: { x: number; y: number };
				data: Record<string, unknown>;
			}>;
			edges: Array<{ id: string; source: string; target: string }>;
		};
		graph.nodes.push({
			id: 'sendEmail-1',
			type: 'sendEmail',
			position: { x: 80, y: 180 },
			data: { label: 'Send', from: `hi@${domain.name}`, subject: 'Hi', templateId: '' },
		});
		graph.edges = [
			{ id: 'e1', source: 'trigger-1', target: 'sendEmail-1' },
			{ id: 'e2', source: 'sendEmail-1', target: 'end-1' },
		];

		const updated = parseContent(
			await handlers.update_flow({
				id: created.id as string,
				name: 'Onboarding v2',
				graph,
			}),
		);
		expect(updated.name).toBe('Onboarding v2');
		expect(updated.status).toBe('draft');
		expect((updated.graph as { nodes: unknown[] }).nodes).toHaveLength(3);

		// Even if a caller somehow passed status through a broken path, the public
		// handler signature has no status field — confirm DB stays draft.
		const fromDb = getFlow(created.id as string, team.id, domain.id);
		expect(fromDb.status).toBe('draft');

		const deleted = parseContent(await handlers.delete_flow({ id: created.id as string }));
		expect(deleted.deleted).toBe(true);
		expect(parseContent(await handlers.list_flows()).flows).toEqual([]);
	});

	it('update_flow handler function has no status parameter', async () => {
		const { handlers } = await setup();
		// Runtime guarantee: spreading a sneaky status must not activate.
		const created = parseContent(await handlers.create_flow({ name: 'Stay draft' }));
		const sneaky = {
			id: created.id as string,
			name: 'Renamed',
			status: 'active' as const,
		};
		const result = parseContent(
			await handlers.update_flow(sneaky as { id: string; name?: string }),
		);
		expect(result.status).toBe('draft');
		expect(result.name).toBe('Renamed');
	});

	it('create_flow requires a domain when scope has none', async () => {
		const team = createTeam();
		const handlers = createHandlers({ teamId: team.id });
		const result = parseContent(await handlers.create_flow({ name: 'No domain' }));
		expect(result.error).toMatch(/domainId is required/i);
	});
});
