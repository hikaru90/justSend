import { eq } from 'drizzle-orm';
import { nowIso } from '$lib/utils';
import { pickEmailLogos } from '$lib/design/extractTokens';
import {
	elementSlug,
	formatElementConfigForPrompt
} from '$lib/template-element-config';
import { env } from '../env';
import { db } from '../db';
import { templates } from '../db/schema';
import { getDesignSystemBundle } from './design-system-service';
import { listElements, type TemplateElement } from './template-element-service';
import { replaceTemplateComponents } from './template-component-service';
import { validateComponentSource, TemplateCompileError } from './template-compile-service';
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

export type ComponentPlanItem = {
	name: string;
	kind: 'root' | 'component';
	role: string;
	/** Element prop slugs this component receives / uses */
	props: string[];
	/** Sub-component names this component imports (root only typically) */
	imports?: string[];
};

export type ComponentPlan = {
	components: ComponentPlanItem[];
};

function elementLines(items: TemplateElement[], assetBaseUrl: string): string {
	return items
		.map((el) => {
			const slug = elementSlug(el.label, el.type);
			const values = formatElementConfigForPrompt(el, { assetBaseUrl });
			const propHints =
				el.type === 'logo' || el.type === 'image'
					? `props: ${slug}, ${slug}_url`
					: el.type === 'text'
						? `props: ${slug}, ${slug}_text`
						: `props: ${slug}, ${slug}_label, ${slug}_url`;
			return `- type=${el.type}; label="${el.label}"; ${propHints}; values: ${values}`;
		})
		.join('\n');
}

function designContextBlocks(input: BuildPromptInput): string {
	const componentBlock =
		input.components.length === 0
			? '(none)'
			: input.components
					.map((c) => {
						const looksSvelte =
							/\$props\s*\(/.test(c.html) || /<\/?script\b/i.test(c.html);
						const fence = looksSvelte ? 'svelte' : 'html';
						return `### ${c.name}${c.description ? ` — ${c.description}` : ''}\n\`\`\`${fence}\n${c.html}\n\`\`\``;
					})
					.join('\n\n');

	const logoAssets = input.assets.filter((a) => a.kind === 'logo');
	const logoPair = pickEmailLogos(logoAssets);
	const nonLogoAssets = input.assets.filter((a) => a.kind !== 'logo');

	const logoBlock = logoPair
		? [
				`- [logo/light] ${logoPair.light.name} (${logoPair.light.filename}) → ${input.assetBaseUrl}/api/design-asset/${logoPair.light.id}`,
				`- [logo/dark] ${logoPair.dark.name} (${logoPair.dark.filename}) → ${input.assetBaseUrl}/api/design-asset/${logoPair.dark.id}`
			].join('\n')
		: '(no logos)';

	const otherAssetBlock =
		nonLogoAssets.length === 0
			? '(none)'
			: nonLogoAssets
					.map(
						(a) =>
							`- [${a.kind}] ${a.name} (${a.filename}) → ${input.assetBaseUrl}/api/design-asset/${a.id}`
					)
					.join('\n');

	const required = input.elements.filter((e) => e.required);
	const optional = input.elements.filter((e) => !e.required);

	return [
		`# Template`,
		`Name: ${input.template.name}`,
		`Subject: ${input.template.subject}`,
		``,
		`# Design system (design.md)`,
		input.designMd?.trim() || '(empty — use a clean, modern default)',
		``,
		`# Library components (reuse structure and patterns — emit Svelte for this template)`,
		componentBlock,
		``,
		`# Logos`,
		logoBlock,
		``,
		`# Other assets`,
		otherAssetBlock,
		``,
		`# Required elements (bind these as $props)`,
		required.length ? elementLines(required, input.assetBaseUrl) : '(none)',
		``,
		`# Optional elements`,
		optional.length ? elementLines(optional, input.assetBaseUrl) : '(none)',
		``,
		`# User prompt`,
		input.prompt.trim() || '(no additional instructions)'
	].join('\n');
}

/** @deprecated Use buildPlannerMessages / buildComponentMessages. Kept for tests during transition. */
export function buildGenerationMessages(input: BuildPromptInput): Array<{
	role: 'system' | 'user';
	content: string;
}> {
	return buildPlannerMessages(input);
}

export function buildPlannerMessages(input: BuildPromptInput): Array<{
	role: 'system' | 'user';
	content: string;
}> {
	const system = [
		'You plan a Svelte 5 email template as a tree of components.',
		'Return ONLY valid JSON (no markdown fences) with this shape:',
		'{ "components": [ { "name": string, "kind": "root"|"component", "role": string, "props": string[], "imports"?: string[] } ] }',
		'Exactly one component must have kind "root" and name "Root".',
		'Component names must be PascalCase identifiers (e.g. Header, Hero, Footer).',
		'props are the element slug names the component receives (e.g. primary_cta, primary_cta_url, headline).',
		'Root imports child components via imports: ["Header","Hero"].',
		'Split layout into 2–6 components. Keep email structure table-based.',
		'Every required element prop must appear on at least one component.',
		'When library components are provided, reuse matching patterns (Header, Footer, CTA, etc.) instead of inventing from scratch.'
	].join(' ');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: designContextBlocks(input) }
	];
}

export function buildComponentMessages(
	input: BuildPromptInput,
	plan: ComponentPlan,
	item: ComponentPlanItem
): Array<{ role: 'system' | 'user'; content: string }> {
	const siblings = plan.components
		.filter((c) => c.name !== item.name)
		.map((c) => `- ${c.name} (${c.kind}): ${c.role}; props=[${c.props.join(', ')}]`)
		.join('\n');

	const system = [
		'You author a single Svelte 5 email component (.svelte source).',
		'Return ONLY the .svelte source. No markdown fences, no commentary.',
		'Rules:',
		'- Use Svelte 5 runes: let { … } = $props();',
		'- Allowed in <script>: relative imports of sibling .svelte components (import X from "./X.svelte") and $props() destructuring ONLY. No other JavaScript.',
		'- No <script module>. No events, no onMount, no fetch.',
		'- Email-safe HTML: tables with <tbody>, inline CSS, no flex/grid reliance.',
		'- Make the layout responsive and mobile-friendly: use percentage/table widths, a max-width ~600px container, fluid images (img { max-width: 100%; height: auto; }), and media queries for ~320px–600px viewports. Never assume a fixed desktop width.',
		'- Keep output HTML-email-friendly: table-based layout, inline CSS, no <style> reliance beyond media queries, no <script>/<form>/<input>, no external CSS or web fonts, no flex/grid, no position:absolute. Use role="presentation" on layout tables.',
		'- Always wrap <tr> inside <tbody>/<thead>/<tfoot>.',
		'- Bind dynamic values via props (e.g. {headline}, href={cta_url}, src={logo_url}). Do NOT hardcode element text/urls/images — use the prop names.',
		'- Every identifier used in markup (including component shorthand like <Header {logo_url} />) MUST appear in that same file\'s let { … } = $props() list. Do not reference undeclared names.',
		'- You may use {#snippet}, {@render}, {#if}, {#each}.',
		'- Support dark mode with @media (prefers-color-scheme: dark) in a <style> block.',
		'- For logos use classes logo-light / logo-dark when both variants are available.',
		`- This component is named ${item.name} (${item.kind}). Role: ${item.role}.`,
		`- It must accept these props: ${item.props.join(', ') || '(none)'}.`,
		item.imports?.length
			? `- It must import and use: ${item.imports.map((n) => `./${n}.svelte`).join(', ')}.`
			: '- Do not import other components unless listed.'
	].join(' ');

	const user = [
		designContextBlocks(input),
		``,
		`# Full component plan`,
		siblings || '(only this component)',
		``,
		`# Generate component: ${item.name}`
	].join('\n');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user }
	];
}

function stripMarkdownFences(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:svelte|html|json)?\s*([\s\S]*?)\s*```$/i);
	return fenced ? fenced[1].trim() : trimmed;
}

function parsePlanJson(raw: string): ComponentPlan {
	const cleaned = stripMarkdownFences(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		// Try to extract a JSON object from surrounding text
		const match = cleaned.match(/\{[\s\S]*\}/);
		if (!match) throw new Error('Planner did not return valid JSON');
		parsed = JSON.parse(match[0]);
	}

	if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ComponentPlan).components)) {
		throw new Error('Planner JSON missing components array');
	}

	const components = (parsed as ComponentPlan).components.map((c, i) => {
		if (!c || typeof c !== 'object') throw new Error(`Invalid component at index ${i}`);
		const name = String(c.name ?? '').trim();
		if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
			throw new Error(`Invalid component name "${name}"`);
		}
		const kind = c.kind === 'root' || name === 'Root' ? 'root' : 'component';
		const props = Array.isArray(c.props) ? c.props.map(String) : [];
		const imports = Array.isArray(c.imports) ? c.imports.map(String) : undefined;
		return {
			name: kind === 'root' ? 'Root' : name,
			kind: kind as 'root' | 'component',
			role: String(c.role ?? name),
			props,
			imports
		};
	});

	const roots = components.filter((c) => c.kind === 'root');
	if (roots.length !== 1) {
		throw new Error(`Plan must have exactly one root (got ${roots.length})`);
	}

	return { components };
}

export type GenerateProgressEvent =
	| { stage: 'preparing'; message: string }
	| { stage: 'planning'; message: string }
	| { stage: 'calling_model'; message: string; model: string }
	| { stage: 'generating_component'; message: string; component: string; index: number; total: number }
	| { stage: 'validating'; message: string; component: string }
	| { stage: 'streaming'; message: string; chars: number }
	| { stage: 'saving'; message: string }
	| { stage: 'done'; message: string }
	| { stage: 'error'; message: string };

export type GenerateTemplateOptions = {
	teamId: number;
	domainId?: number;
	templateId: string;
	prompt: string;
	assetBaseUrl?: string;
	signal?: AbortSignal;
	onProgress?: (event: GenerateProgressEvent) => void;
};

async function readOpenRouterStream(
	response: Response,
	opts: {
		signal?: AbortSignal;
		onDelta?: (chars: number) => void;
	}
): Promise<string> {
	if (!response.body) {
		throw new Error('OpenRouter returned an empty stream body');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let content = '';

	try {
		while (true) {
			if (opts.signal?.aborted) {
				throw new DOMException('Generation cancelled', 'AbortError');
			}
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith(':')) continue;
				if (!trimmed.startsWith('data:')) continue;
				const data = trimmed.slice(5).trim();
				if (data === '[DONE]') continue;
				try {
					const parsed = JSON.parse(data) as {
						choices?: Array<{ delta?: { content?: string } }>;
					};
					const delta = parsed.choices?.[0]?.delta?.content;
					if (delta) {
						content += delta;
						opts.onDelta?.(content.length);
					}
				} catch {
					// ignore malformed SSE chunks
				}
			}
		}
	} finally {
		reader.releaseLock();
	}

	return content;
}

async function openRouterChat(
	messages: Array<{ role: 'system' | 'user'; content: string }>,
	opts: {
		signal?: AbortSignal;
		stream?: boolean;
		onDelta?: (chars: number) => void;
	}
): Promise<string> {
	if (!env.OPENROUTER_API_KEY) {
		throw new Error('OPENROUTER_API_KEY is not configured');
	}

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
			messages,
			stream: opts.stream !== false
		}),
		signal: opts.signal
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`);
	}

	if (opts.stream === false) {
		const json = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		return json.choices?.[0]?.message?.content ?? '';
	}

	return readOpenRouterStream(response, {
		signal: opts.signal,
		onDelta: opts.onDelta
	});
}

const MAX_COMPONENT_RETRIES = 2;

/**
 * Generate a Svelte component-tree email template:
 * 1) Planner JSON → component list
 * 2) Per-component .svelte source (validated)
 * 3) Persist to template_components
 */
export async function generateTemplateHtml(opts: GenerateTemplateOptions): Promise<Template> {
	const emit = (event: GenerateProgressEvent) => opts.onProgress?.(event);

	emit({ stage: 'preparing', message: 'Loading design system, components, and required elements…' });

	if (opts.signal?.aborted) {
		throw new DOMException('Generation cancelled', 'AbortError');
	}

	const template = getTemplate(opts.templateId, opts.teamId, opts.domainId);
	const bundle = getDesignSystemBundle(opts.teamId);
	const elements = listElements(opts.templateId, opts.teamId, opts.domainId);
	const assetBaseUrl = (opts.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');

	const promptInput: BuildPromptInput = {
		template,
		designMd: bundle.system?.designMd ?? null,
		components: bundle.components,
		assets: bundle.assets,
		elements,
		prompt: opts.prompt,
		assetBaseUrl
	};

	emit({ stage: 'planning', message: 'Planning Svelte component tree…' });
	emit({
		stage: 'calling_model',
		message: `Sending plan prompt to ${env.OPENROUTER_MODEL}…`,
		model: env.OPENROUTER_MODEL
	});

	const planRaw = await openRouterChat(buildPlannerMessages(promptInput), {
		signal: opts.signal,
		stream: true,
		onDelta: (chars) => {
			emit({
				stage: 'streaming',
				message: `Receiving plan… (${chars.toLocaleString()} characters)`,
				chars
			});
		}
	});

	if (!planRaw?.trim()) {
		throw new Error('Planner returned empty content');
	}

	const plan = parsePlanJson(planRaw);
	emit({
		stage: 'planning',
		message: `Plan ready: ${plan.components.map((c) => c.name).join(', ')}`
	});

	const generated: Array<{ name: string; kind: 'root' | 'component'; source: string; order: number }> =
		[];

	for (let i = 0; i < plan.components.length; i++) {
		const item = plan.components[i];
		emit({
			stage: 'generating_component',
			message: `Generating ${item.name}…`,
			component: item.name,
			index: i + 1,
			total: plan.components.length
		});

		let lastError: Error | undefined;
		let source: string | undefined;

		for (let attempt = 0; attempt <= MAX_COMPONENT_RETRIES; attempt++) {
			if (opts.signal?.aborted) {
				throw new DOMException('Generation cancelled', 'AbortError');
			}

			const messages = buildComponentMessages(promptInput, plan, item);
			if (attempt > 0 && lastError) {
				messages.push({
					role: 'user',
					content: `Previous attempt failed validation:\n${lastError.message}\n\nFix the .svelte source and return ONLY the corrected file.`
				});
			}

			const raw = await openRouterChat(messages, {
				signal: opts.signal,
				stream: true,
				onDelta: (chars) => {
					emit({
						stage: 'streaming',
						message: `Writing ${item.name}… (${chars.toLocaleString()} characters)`,
						chars
					});
				}
			});

			source = stripMarkdownFences(raw ?? '');
			if (!source.trim()) {
				lastError = new Error('Empty component source');
				continue;
			}

			emit({ stage: 'validating', message: `Validating ${item.name}…`, component: item.name });

			try {
				validateComponentSource(item.name, source);
				lastError = undefined;
				break;
			} catch (e) {
				lastError =
					e instanceof TemplateCompileError
						? e
						: new Error(e instanceof Error ? e.message : String(e));
			}
		}

		if (lastError || !source) {
			throw new Error(
				`Failed to generate valid component ${item.name}: ${lastError?.message ?? 'unknown'}`
			);
		}

		generated.push({
			name: item.name,
			kind: item.kind,
			source,
			order: i
		});
	}

	emit({ stage: 'saving', message: 'Saving Svelte components…' });

	replaceTemplateComponents(opts.templateId, opts.teamId, opts.domainId, generated);

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
		elements,
		plan
	});

	// Clear legacy html so send path prefers components; keep prompt + snapshot.
	const updated = db
		.update(templates)
		.set({
			html: null,
			prompt: opts.prompt,
			designSnapshot,
			updatedAt: nowIso()
		})
		.where(eq(templates.id, template.id))
		.returning()
		.get();

	emit({ stage: 'done', message: 'Generation complete.' });
	return updated;
}
