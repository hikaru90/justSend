import type { RequestHandler } from './$types';
import { requireApiTeam } from '$lib/server/api/auth';
import { handleOwleryMcpHttp } from '$lib/server/mcp/http';
import { scopeFromApiAuth } from '$lib/server/mcp/scope';

async function handle(request: Request): Promise<Response> {
	const auth = await requireApiTeam(request);
	return handleOwleryMcpHttp(request, scopeFromApiAuth(auth));
}

/** MCP Streamable HTTP endpoint — auth with `Authorization: Bearer us_…` */
export const GET: RequestHandler = async ({ request }) => handle(request);
export const POST: RequestHandler = async ({ request }) => handle(request);
export const DELETE: RequestHandler = async ({ request }) => handle(request);

export const OPTIONS: RequestHandler = async () =>
	new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers':
				'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
			'Access-Control-Max-Age': '86400',
		},
	});
