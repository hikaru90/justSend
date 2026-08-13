import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../tests/helpers/db';
import { createTeamWithApiKey } from '../../tests/helpers/factories';
import { bearer, buildApiEvent, invokeHandler } from '../../tests/helpers/api';
import { _resetMcpSessionsForTests } from '$lib/server/mcp/http';
import { GET, POST } from './+server';

beforeEach(() => {
	resetDb();
	_resetMcpSessionsForTests();
});

describe('POST /mcp', () => {
	it('rejects missing Authorization', async () => {
		const event = buildApiEvent({
			method: 'POST',
			path: '/mcp',
			body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
			headers: { Accept: 'application/json, text/event-stream' },
		});
		const { status } = await invokeHandler(POST, event);
		expect(status).toBe(401);
	});

	it('accepts initialize with Bearer API key and returns session id', async () => {
		const { apiKey } = await createTeamWithApiKey();
		const event = buildApiEvent({
			method: 'POST',
			path: '/mcp',
			headers: {
				...bearer(apiKey),
				Accept: 'application/json, text/event-stream',
			},
			body: {
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2025-03-26',
					capabilities: {},
					clientInfo: { name: 'test', version: '0.0.0' },
				},
			},
		});

		const { status, json, response } = await invokeHandler(POST, event);
		expect(status).toBe(200);
		expect(json).toMatchObject({
			jsonrpc: '2.0',
			id: 1,
			result: {
				serverInfo: { name: 'owlery' },
			},
		});
		expect(response?.headers.get('mcp-session-id')).toBeTruthy();
	});

	it('lists compose tools on a session', async () => {
		const { apiKey } = await createTeamWithApiKey();
		const authHeaders = {
			...bearer(apiKey),
			Accept: 'application/json, text/event-stream',
		};

		const init = await invokeHandler(
			POST,
			buildApiEvent({
				method: 'POST',
				path: '/mcp',
				headers: authHeaders,
				body: {
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {
						protocolVersion: '2025-03-26',
						capabilities: {},
						clientInfo: { name: 'test', version: '0.0.0' },
					},
				},
			}),
		);
		const sessionId = init.response?.headers.get('mcp-session-id');
		expect(sessionId).toBeTruthy();

		const { status, json } = await invokeHandler(
			POST,
			buildApiEvent({
				method: 'POST',
				path: '/mcp',
				headers: {
					...authHeaders,
					'mcp-session-id': sessionId!,
				},
				body: {
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/list',
					params: {},
				},
			}),
		);

		expect(status).toBe(200);
		const tools = (json as { result: { tools: Array<{ name: string }> } }).result.tools;
		const names = tools.map((t) => t.name).sort();
		expect(names).toContain('list_flows');
		expect(names).toContain('list_templates');
		expect(names).toContain('describe_owl_doc');
		expect(names).not.toContain('activate_flow');
		expect(names).not.toContain('send_email');
	});
});

describe('GET /mcp', () => {
	it('requires Bearer auth', async () => {
		const event = buildApiEvent({
			method: 'GET',
			path: '/mcp',
			headers: { Accept: 'text/event-stream' },
		});
		const { status } = await invokeHandler(GET, event);
		expect(status).toBe(401);
	});
});
