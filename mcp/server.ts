/**
 * Owlery MCP server (stdio).
 *
 * Prefer the HTTP endpoint on a running Owlery instance:
 *   POST/GET https://<host>/mcp
 *   Authorization: Bearer <api-key>
 *
 * Stdio env:
 *   OWLERY_API_KEY   (required)
 *   OWLERY_DOMAIN_ID (optional)
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { migrate } from '$lib/server/db/migrate';
import { createOwleryMcpServer } from '$lib/server/mcp/create-server';
import { resolveScopeFromEnv } from '$lib/server/mcp/scope';

export { createOwleryMcpServer } from '$lib/server/mcp/create-server';
export { resolveScopeFromEnv } from '$lib/server/mcp/scope';
export type { McpScope } from '$lib/server/mcp/handlers';

export async function main() {
	migrate();
	const scope = await resolveScopeFromEnv();
	const server = createOwleryMcpServer(scope);
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error(
		`owlery MCP ready (teamId=${scope.teamId}${scope.domainId != null ? ` domainId=${scope.domainId}` : ''})`,
	);
}

const isDirectRun =
	process.argv[1] &&
	(process.argv[1].endsWith('/mcp/server.ts') ||
		process.argv[1].endsWith('\\mcp\\server.ts') ||
		process.argv[1].endsWith('/mcp/server.js'));

if (isDirectRun) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : err);
		process.exit(1);
	});
}
