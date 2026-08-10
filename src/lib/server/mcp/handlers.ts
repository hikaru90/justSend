import { renderOwlDocHtml } from '$lib/email/owl/render-doc';
import { parseOwlDoc } from '$lib/email/owl/studio';
import {
	createFlow,
	deleteFlow,
	getFlow,
	listFlows,
	updateFlow,
	type FlowGraph,
	type TriggerConfig,
} from '$lib/server/service/flow-service';
import {
	createTemplate,
	deleteTemplate,
	getTemplate,
	listTemplates,
	updateTemplate,
} from '$lib/server/service/template-service';
import { OWL_DOC_GUIDE, OWL_DOC_MINIMAL_EXAMPLE } from './owl-doc-guide';

export type McpScope = {
	teamId: number;
	domainId?: number;
};

function textResult(data: unknown, isError = false) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
		isError,
	};
}

function errorResult(err: unknown) {
	const message = err instanceof Error ? err.message : String(err);
	return textResult({ error: message }, true);
}

function asContentString(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value === 'string') return value;
	return JSON.stringify(value);
}

/** Returns a helpful MCP error payload if content is present but not a valid OwlDoc. */
function invalidOwlDocResult(content: string) {
	return textResult(
		{
			error: 'Invalid OwlDoc in content. Owlery does not use MJML/React Email/bare HTML as content.',
			hint: OWL_DOC_GUIDE,
			example: OWL_DOC_MINIMAL_EXAMPLE,
			receivedPreview: content.slice(0, 240),
		},
		true,
	);
}

function requireOwlDocContent(raw: unknown): { ok: true; content: string } | { ok: false; result: ReturnType<typeof textResult> } {
	const content = asContentString(raw);
	if (content === undefined || content === null || content === '') {
		return { ok: true, content: content ?? '' };
	}
	if (!parseOwlDoc(content)) {
		return { ok: false, result: invalidOwlDocResult(content) };
	}
	return { ok: true, content };
}

export function createHandlers(scope: McpScope) {
	const { teamId, domainId } = scope;

	return {
		async describe_owl_doc() {
			return textResult({
				format: 'OwlDoc',
				guide: OWL_DOC_GUIDE,
				example: OWL_DOC_MINIMAL_EXAMPLE,
			});
		},

		async list_templates() {
			try {
				const templates = listTemplates(teamId, domainId).map((t) => ({
					id: t.id,
					name: t.name,
					subject: t.subject,
					domainId: t.domainId,
					tags: t.tagList,
					createdAt: t.createdAt,
					updatedAt: t.updatedAt,
					hasContent: Boolean(t.content),
					hasHtml: Boolean(t.html),
				}));
				return textResult({ templates });
			} catch (err) {
				return errorResult(err);
			}
		},

		async get_template(args: { id: string }) {
			try {
				const t = getTemplate(args.id, teamId, domainId);
				return textResult({
					id: t.id,
					name: t.name,
					subject: t.subject,
					domainId: t.domainId,
					tags: t.tags,
					prompt: t.prompt,
					content: t.content,
					html: t.html,
					designSnapshot: t.designSnapshot,
					createdAt: t.createdAt,
					updatedAt: t.updatedAt,
				});
			} catch (err) {
				return errorResult(err);
			}
		},

		async create_template(args: {
			name: string;
			subject?: string;
			content?: unknown;
			html?: string | null;
			tags?: string[];
			domainId?: number;
		}) {
			try {
				let content: string | null = null;
				if (args.content !== undefined && args.content !== null) {
					const checked = requireOwlDocContent(args.content);
					if (!checked.ok) return checked.result;
					content = checked.content || null;
				}
				const tpl = createTemplate({
					teamId,
					domainId: args.domainId ?? domainId ?? null,
					name: args.name,
					subject: args.subject ?? '',
					content,
					html: args.html ?? null,
				});
				if (args.tags !== undefined) {
					const updated = updateTemplate(tpl.id, teamId, { tags: args.tags }, domainId);
					return textResult(updated);
				}
				return textResult(tpl);
			} catch (err) {
				return errorResult(err);
			}
		},

		async update_template(args: {
			id: string;
			name?: string;
			subject?: string;
			content?: unknown;
			html?: string | null;
			prompt?: string | null;
			tags?: string[];
		}) {
			try {
				let contentPatch: string | null | undefined;
				if (args.content !== undefined) {
					if (args.content === null) {
						contentPatch = null;
					} else {
						const checked = requireOwlDocContent(args.content);
						if (!checked.ok) return checked.result;
						contentPatch = checked.content;
					}
				}
				const updated = updateTemplate(
					args.id,
					teamId,
					{
						...(args.name !== undefined ? { name: args.name } : {}),
						...(args.subject !== undefined ? { subject: args.subject } : {}),
						...(contentPatch !== undefined ? { content: contentPatch } : {}),
						...(args.html !== undefined ? { html: args.html } : {}),
						...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
						...(args.tags !== undefined ? { tags: args.tags } : {}),
					},
					domainId,
				);
				return textResult(updated);
			} catch (err) {
				return errorResult(err);
			}
		},

		async delete_template(args: { id: string }) {
			try {
				const deleted = deleteTemplate(args.id, teamId, domainId);
				return textResult({ deleted: true, id: deleted.id, name: deleted.name });
			} catch (err) {
				return errorResult(err);
			}
		},

		async compile_template_preview(args: { id: string }) {
			try {
				const t = getTemplate(args.id, teamId, domainId);
				const doc = parseOwlDoc(t.content);
				if (!doc) {
					return textResult(
						{
							error:
								'Template has no valid OwlDoc content (expected JSON with owl:"v1"). Nothing was sent or persisted.',
							hint: OWL_DOC_GUIDE,
							example: OWL_DOC_MINIMAL_EXAMPLE,
						},
						true,
					);
				}
				// renderOwlDocHtml is the worker/tsx-safe pipeline (same as compileOwlDoc,
				// without Vite-only starters). Preview only — never persists or sends.
				const { html, issues } = await renderOwlDocHtml(doc);
				return textResult({
					id: t.id,
					html,
					issues,
					note: 'Preview only — not persisted and not sent.',
				});
			} catch (err) {
				return errorResult(err);
			}
		},

		async list_flows() {
			try {
				const flows = listFlows(teamId, domainId).map((f) => ({
					id: f.id,
					name: f.name,
					status: f.status,
					domainId: f.domainId,
					triggerType: f.triggerType,
					triggerConfig: f.triggerConfig,
					nodeCount: f.graph.nodes.length,
					createdAt: f.createdAt,
					updatedAt: f.updatedAt,
				}));
				return textResult({ flows });
			} catch (err) {
				return errorResult(err);
			}
		},

		async get_flow(args: { id: string }) {
			try {
				const flow = getFlow(args.id, teamId, domainId);
				return textResult(flow);
			} catch (err) {
				return errorResult(err);
			}
		},

		async create_flow(args: {
			name: string;
			domainId?: number;
			triggerConfig?: TriggerConfig;
		}) {
			try {
				const resolvedDomainId = args.domainId ?? domainId;
				if (resolvedDomainId === undefined) {
					return textResult(
						{
							error:
								'domainId is required to create a flow (pass domainId or set OWLERY_DOMAIN_ID / use a domain-scoped API key).',
						},
						true,
					);
				}
				const flow = createFlow({
					teamId,
					domainId: resolvedDomainId,
					name: args.name,
					triggerConfig: args.triggerConfig,
				});
				return textResult(flow);
			} catch (err) {
				return errorResult(err);
			}
		},

		async update_flow(args: {
			id: string;
			name?: string;
			triggerType?: string;
			triggerConfig?: TriggerConfig;
			graph?: FlowGraph;
		}) {
			try {
				// Intentionally no `status` — activation/pause is not available via MCP.
				const flow = updateFlow(
					args.id,
					teamId,
					{
						...(args.name !== undefined ? { name: args.name } : {}),
						...(args.triggerType !== undefined ? { triggerType: args.triggerType } : {}),
						...(args.triggerConfig !== undefined ? { triggerConfig: args.triggerConfig } : {}),
						...(args.graph !== undefined ? { graph: args.graph } : {}),
					},
					domainId,
				);
				return textResult(flow);
			} catch (err) {
				return errorResult(err);
			}
		},

		async delete_flow(args: { id: string }) {
			try {
				deleteFlow(args.id, teamId, domainId);
				return textResult({ deleted: true, id: args.id });
			} catch (err) {
				return errorResult(err);
			}
		},
	};
}

export type OwleryMcpHandlers = ReturnType<typeof createHandlers>;
