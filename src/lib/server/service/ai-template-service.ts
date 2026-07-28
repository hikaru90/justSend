import { eq } from 'drizzle-orm';
import { nowIso } from '$lib/utils';
import { env } from '../env';
import { db } from '../db';
import { templates } from '../db/schema';
import { getDesignSystemBundle } from './design-system-service';
import { listElements, type TemplateElement } from './template-element-service';
import { getTemplate, type Template } from './template-service';

export type BuildPromptInput = {
	template: Template;
	designMd: string | null;
	components: Array<{ name: string; description: string | null; html: string }>;
	assets: Array<{ id: string; kind: string; name: string; filename: string }>;
	elements: TemplateElement[];
	prompt: string;
	assetBaseUrl: string;
};

export function buildGenerationMessages(input: BuildPromptInput): Array<{
	role: 'system' | 'user';
	content: string;
}> {
	const required = input.elements.filter((e) => e.required);
	const optional = input.elements.filter((e) => !e.required);

	const elementLines = (items: TemplateElement[]) =>
		items
			.map((el) => {
				const slug = el.label
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '_')
					.replace(/^_|_$/g, '');
				return `- type=${el.type}; label="${el.label}"; placeholder={{${slug || el.type}}}; config=${el.config}`;
			})
			.join('\n');

	const componentBlock =
		input.components.length === 0
			? '(none)'
			: input.components
					.map(
						(c) =>
							`### ${c.name}${c.description ? ` — ${c.description}` : ''}\n\`\`\`html\n${c.html}\n\`\`\``
					)
					.join('\n\n');

	const assetBlock =
		input.assets.length === 0
			? '(none)'
			: input.assets
					.map(
						(a) =>
							`- [${a.kind}] ${a.name} (${a.filename}) → ${input.assetBaseUrl}/api/design-asset/${a.id}`
					)
					.join('\n');

	const system = [
		'You generate self-contained HTML email templates.',
		'Return ONLY the HTML document (or a single HTML fragment suitable for email). No markdown fences, no commentary.',
		'Use table-based layout and inline CSS suitable for email clients.',
		'Follow the provided design system (design.md + components + assets) as the visual baseline.',
		'Every required element MUST appear in the HTML.',
		'Use {{variable}} placeholders for dynamic text (matching the placeholders listed for each element).',
		'Reference uploaded assets via the absolute URLs provided.'
	].join(' ');

	const user = [
		`# Template`,
		`Name: ${input.template.name}`,
		`Subject: ${input.template.subject}`,
		``,
		`# Design system (design.md)`,
		input.designMd?.trim() || '(empty — use a clean, modern default)',
		``,
		`# Components`,
		componentBlock,
		``,
		`# Assets`,
		assetBlock,
		``,
		`# Required elements`,
		required.length ? elementLines(required) : '(none)',
		``,
		`# Optional elements`,
		optional.length ? elementLines(optional) : '(none)',
		``,
		`# User prompt`,
		input.prompt.trim() || '(no additional instructions)'
	].join('\n');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

function stripMarkdownFences(html: string): string {
	const trimmed = html.trim();
	const fenced = trimmed.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
	return fenced ? fenced[1].trim() : trimmed;
}

export async function generateTemplateHtml(opts: {
	teamId: number;
	domainId?: number;
	templateId: string;
	prompt: string;
	assetBaseUrl?: string;
}): Promise<Template> {
	if (!env.OPENROUTER_API_KEY) {
		throw new Error('OPENROUTER_API_KEY is not configured');
	}

	const template = getTemplate(opts.templateId, opts.teamId, opts.domainId);
	const bundle = getDesignSystemBundle(opts.teamId);
	const elements = listElements(opts.templateId, opts.teamId, opts.domainId);
	const assetBaseUrl = (opts.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');

	const messages = buildGenerationMessages({
		template,
		designMd: bundle.system?.designMd ?? null,
		components: bundle.components,
		assets: bundle.assets,
		elements,
		prompt: opts.prompt,
		assetBaseUrl
	});

	const response = await fetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': env.HOST_URL,
			'X-Title': 'Owlery'
		},
		body: JSON.stringify({
			model: env.OPENROUTER_MODEL,
			messages
		})
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const raw = data.choices?.[0]?.message?.content;
	if (!raw?.trim()) {
		throw new Error('OpenRouter returned empty content');
	}

	const html = stripMarkdownFences(raw);
	const designSnapshot = JSON.stringify({
		designMd: bundle.system?.designMd ?? null,
		components: bundle.components.map((c) => ({
			id: c.id,
			name: c.name,
			description: c.description,
			html: c.html
		})),
		assets: bundle.assets.map((a) => ({
			id: a.id,
			kind: a.kind,
			name: a.name,
			filename: a.filename
		})),
		elements
	});

	return db
		.update(templates)
		.set({
			html,
			prompt: opts.prompt,
			designSnapshot,
			updatedAt: nowIso()
		})
		.where(eq(templates.id, template.id))
		.returning()
		.get();
}
