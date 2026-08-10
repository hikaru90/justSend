import { randomUUID } from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createOwleryMcpServer } from './create-server';
import type { McpScope } from './handlers';

type Session = {
	server: McpServer;
	transport: WebStandardStreamableHTTPServerTransport;
	teamId: number;
	domainId?: number;
};

const sessions = new Map<string, Session>();

function sessionMatches(session: Session, scope: McpScope) {
	return (
		session.teamId === scope.teamId &&
		(session.domainId ?? undefined) === (scope.domainId ?? undefined)
	);
}

/**
 * Streamable HTTP MCP handler with in-memory sessions (single-node).
 * Clients (Hermes, Cursor, …) send `Authorization: Bearer us_…` and reuse
 * the `mcp-session-id` response header on follow-up requests.
 */
export async function handleOwleryMcpHttp(
	request: Request,
	scope: McpScope,
): Promise<Response> {
	const existingId = request.headers.get('mcp-session-id');
	if (existingId) {
		const session = sessions.get(existingId);
		if (!session || !sessionMatches(session, scope)) {
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					error: { code: -32001, message: 'Session not found' },
					id: null,
				}),
				{ status: 404, headers: { 'Content-Type': 'application/json' } },
			);
		}
		return session.transport.handleRequest(request);
	}

	// New session (initialize / first request)
	const server = createOwleryMcpServer(scope);
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: () => randomUUID(),
		onsessioninitialized: (id) => {
			sessions.set(id, {
				server,
				transport,
				teamId: scope.teamId,
				domainId: scope.domainId,
			});
		},
		onsessionclosed: (id) => {
			const session = sessions.get(id);
			sessions.delete(id);
			void session?.server.close().catch(() => {});
		},
		enableJsonResponse: true,
	});

	await server.connect(transport);
	const response = await transport.handleRequest(request);

	// If initialize never created a session (e.g. malformed body), clean up.
	if (!transport.sessionId) {
		await transport.close().catch(() => {});
		await server.close().catch(() => {});
	}

	return response;
}

/** Test helpers */
export function _resetMcpSessionsForTests() {
	sessions.clear();
}

export function _mcpSessionCountForTests() {
	return sessions.size;
}
