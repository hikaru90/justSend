import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHandlers, type McpScope } from './handlers';
import { OWL_DOC_GUIDE } from './owl-doc-guide';

export type { McpScope };

const SAFETY =
	'This MCP never activates or pauses flows, enrolls contacts, or sends/queues email. Compose only.';

const CONTENT_DESC =
	'OwlDoc JSON object or string. NOT MJML/React Email/bare HTML. Must include owl:"v1", shell (with <!--owl:sections-->), sections[], slotValues. Call describe_owl_doc for the full format + example.';

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

export function createOwleryMcpServer(scope: McpScope): McpServer {
	const handlers = createHandlers(scope);
	const server = new McpServer({
		name: 'owlery',
		version: '0.1.0',
	});

	server.registerTool(
		'describe_owl_doc',
		{
			description: `Return the OwlDoc format guide and a minimal valid example. Call this BEFORE create_template or update_template if you are unsure how to structure content. ${SAFETY}`,
			inputSchema: {},
		},
		async () => handlers.describe_owl_doc(),
	);

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
			description: `Get a template by id. The \`content\` field is OwlDoc JSON (source of truth). ${OWL_DOC_GUIDE} ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Template id'),
			},
		},
		async (args) => handlers.get_template(args),
	);

	server.registerTool(
		'create_template',
		{
			description: `Create a template. Set \`content\` to an OwlDoc — do not invent another templating language. ${OWL_DOC_GUIDE} Prefer leaving html null; use compile_template_preview after create. ${SAFETY}`,
			inputSchema: {
				name: z.string().describe('Template name'),
				subject: z.string().optional().describe('Email subject (may include {{firstName}} etc.)'),
				content: contentSchema.describe(CONTENT_DESC),
				html: z
					.string()
					.nullable()
					.optional()
					.describe(
						'Optional cached delivery HTML — leave null; not a substitute for OwlDoc content',
					),
				tags: z.array(z.string()).optional(),
				domainId: z.number().int().positive().optional(),
			},
		},
		async (args) => handlers.create_template(args),
	);

	server.registerTool(
		'update_template',
		{
			description: `Update a template. Always get_template first, then patch OwlDoc \`content\` (owl:"v1" envelope). ${OWL_DOC_GUIDE} ${SAFETY}`,
			inputSchema: {
				id: z.string().describe('Template id'),
				name: z.string().optional(),
				subject: z.string().optional(),
				content: contentSchema.describe(CONTENT_DESC),
				html: z.string().nullable().optional().describe('Optional cached delivery HTML snapshot'),
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
			description: `Compile OwlDoc content to delivery HTML for preview. Fails with the OwlDoc guide if content is missing/invalid. Does not persist and does not send. ${SAFETY}`,
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
			description: `Create a draft flow with a default trigger→end graph. Domain is required (arg or domain-scoped API key). Cannot activate. ${SAFETY}`,
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
