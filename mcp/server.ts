/**
 * Owlery MCP server (stdio).
 *
 * Compose-only access to flows and templates: list/get/create/update/delete.
 * Never activates/pauses flows and never sends or queues email.
 *
 * Env:
 *   OWLERY_API_KEY   (required) — team API key (`us_…`)
 *   OWLERY_DOMAIN_ID (optional) — restrict tools to one domain
 *   DATABASE_URL / AUTH_SECRET / … — same as the main app (via dotenv)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { migrate } from '$lib/server/db/migrate';
import { getTeamAndApiKey } from '$lib/server/service/api-service';
import { createHandlers, type McpScope } from './handlers.ts';

const SAFETY =
	'This MCP never activates or pauses flows, enrolls contacts, or sends/queues email. Compose only.';

const flowGraphSchema = z.object({
	nodes: z.array(
		z.object({
			id: z.string(),
			type: z.string().optional(),
			position: z.object({ x: z.number(), y: z.number() }),
			data: z.record(z.string(), z.unknown()),
		}),
	),
	edges: z.array(
		z.object({
			id: z.string(),
			source: z.string(),
			target: z.string(),
			sourceHandle: z.string().nullable().optional(),
			targetHandle: z.string().nullable().optional(),
		}),
	),
});

const triggerConfigSchema = z.object({
	contactBookId: z.string().optional(),
});

/** Content may be an OwlDoc JSON string or a parsed object. */
const contentSchema = z.union([z.string(), z.record(z.string(), z.unknown())]).optional();

export async function resolveScopeFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): Promise<McpScope> {
	const apiKey = env.OWLERY_API_KEY?.trim();
	if (!apiKey) {
		throw new Error('OWLERY_API_KEY is required');
	}

	const result = await getTeamAndApiKey(apiKey);
	if (!result?.team || !result.apiKey) {
		throw new Error('Invalid OWLERY_API_KEY');
	}

	const envDomain = env.OWLERY_DOMAIN_ID?.trim();
	let domainId: number | undefined;
	if (envDomain) {
		const parsed = Number(envDomain);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			throw new Error('OWLERY_DOMAIN_ID must be a positive integer');
		}
		domainId = parsed;
	} else if (result.apiKey.domainId != null) {
		domainId = result.apiKey.domainId;
	}

	return { teamId: result.team.id, domainId };
}

export function createOwleryMcpServer(scope: McpScope): McpServer {
	const handlers = createHandlers(scope);
	const server = new McpServer({
		name: 'owlery',
		version: '0.1.0',
	});

	server.registerTool(
		'list_templates',
		{
			description: `List email templates for the authenticated team (summary only). ${SAFETY}`,
			inputSchema: {},
		},
		async () => handlers.list_templates(),
	);

	server.registerTool(
		'get_template',
		{
			description: `Get a template by id, including OwlDoc content JSON (source of truth) and cached html. ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Template id'),
			},
		},
		async (args) => handlers.get_template(args),
	);

	server.registerTool(
		'create_template',
		{
			description: `Create a template. Prefer OwlDoc JSON in content; html is a cached delivery snapshot recompiled on studio save/send. ${SAFETY}`,
			inputSchema: {
				name: z.string().describe('Template name'),
				subject: z.string().optional().describe('Email subject (may include {{variables}})'),
				content: contentSchema.describe('OwlDoc JSON string or object'),
				html: z.string().nullable().optional().describe('Optional cached HTML snapshot'),
				tags: z.array(z.string()).optional(),
				domainId: z.number().int().positive().optional(),
			},
		},
		async (args) => handlers.create_template(args),
	);

	server.registerTool(
		'update_template',
		{
			description: `Update a template. Edit content (OwlDoc) as the source of truth; fetch with get_template first. html is optional cached snapshot. ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Template id'),
				name: z.string().optional(),
				subject: z.string().optional(),
				content: contentSchema.describe('OwlDoc JSON string or object'),
				html: z.string().nullable().optional(),
				prompt: z.string().nullable().optional(),
				tags: z.array(z.string()).optional(),
			},
		},
		async (args) => handlers.update_template(args),
	);

	server.registerTool(
		'delete_template',
		{
			description: `Permanently delete a template. ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Template id'),
			},
		},
		async (args) => handlers.delete_template(args),
	);

	server.registerTool(
		'compile_template_preview',
		{
			description: `Compile OwlDoc content to delivery HTML for preview. Does not persist and does not send. ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Template id'),
			},
		},
		async (args) => handlers.compile_template_preview(args),
	);

	server.registerTool(
		'list_flows',
		{
			description: `List automation flows (summary). Status is read-only here — activation is not available. ${SAFETY}`,
			inputSchema: {},
		},
		async () => handlers.list_flows(),
	);

	server.registerTool(
		'get_flow',
		{
			description: `Get a flow including its graph (nodes/edges). Node types: trigger, sendEmail, wait, end. ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Flow id'),
			},
		},
		async (args) => handlers.get_flow(args),
	);

	server.registerTool(
		'create_flow',
		{
			description: `Create a draft flow with a default trigger→end graph. Domain is required (arg or OWLERY_DOMAIN_ID / domain-scoped key). Cannot activate. ${SAFETY}`,
			inputSchema: {
				name: z.string().describe('Flow name'),
				domainId: z
					.number()
					.int()
					.positive()
					.optional()
					.describe('Domain id (required if not set via env/API key)'),
				triggerConfig: triggerConfigSchema.optional(),
			},
		},
		async (args) => handlers.create_flow(args),
	);

	server.registerTool(
		'update_flow',
		{
			description: `Update flow name, trigger, or graph. Status cannot be changed via MCP (no activate/pause). ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Flow id'),
				name: z.string().optional(),
				triggerType: z.string().optional(),
				triggerConfig: triggerConfigSchema.optional(),
				graph: flowGraphSchema.optional(),
			},
		},
		async (args) => handlers.update_flow(args),
	);

	server.registerTool(
		'delete_flow',
		{
			description: `Permanently delete a flow. ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Flow id'),
			},
		},
		async (args) => handlers.delete_flow(args),
	);

	return server;
}

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
