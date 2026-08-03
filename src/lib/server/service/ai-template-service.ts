import { relativizeDesignAssetUrls } from '$lib/design-asset-urls';
import { eq } from 'drizzle-orm';
import { nowIso } from '$lib/utils';
import { pickEmailLogos } from '$lib/design/extractTokens';
import {
	elementSlug,
	formatElementConfigForPrompt,
	parseElementConfig,
} from '$lib/template-element-config';
import { EMAIL_FORMATTING_RULES } from '../email-formatting-rules';
import { env } from '../env';
import { db } from '../db';
import { templates } from '../db/schema';
import { getDesignSystemBundle, parseComponentProps } from './design-system-service';
import { listElements, type TemplateElement } from './template-element-service';
import { getTemplate, type Template } from './template-service';
import { openRouterChat, openRouterModel } from './openrouter';
import {
	collectExpectedSlots,
	parseScaffoldContent,
	serializeScaffoldContent,
	type ScaffoldContent,
} from './template-compose-service';
import { parseEmailBuilderContent, serializeEmailBuilderContent } from '$lib/email-builder/render';

export type BuildPromptInput = {
	template: Template;
	designMd: string | null;
	components: Array<{
		id: string;
		name: string;
		description: string | null;
		html: string;
		kind: string;
		role: string;
		props: string;
		starterKey: string | null;
		slots?: string;
		document?: string;
	}>;
	assets: Array<{ id: string; kind: string; name: string; filename: string }>;
	elements: TemplateElement[];
	prompt: string;
	assetBaseUrl: string;
	expectedSlots: string[];
};

function elementLines(
	items: TemplateElement[],
	assetBaseUrl: string,
	input: BuildPromptInput,
): string {
	const designComponentById = Object.fromEntries(
		input.components.map((c) => [c.id, { name: c.name, starterKey: c.starterKey }]),
	);

	return items
		.map((el) => {
			const slug = elementSlug(el.label, el.type);
			const values = formatElementConfigForPrompt(el, { assetBaseUrl, designComponentById });
			if (el.type === 'component') {
				const config = parseElementConfig(el.config);
				const lib = config.designComponentId
					? input.components.find((c) => c.id === config.designComponentId)
					: undefined;
				const props = lib ? parseComponentProps(lib).join(', ') : '';
				return `- type=component; label="${el.label}"; library="${lib?.name ?? '?'}"; slots=[${props}]; ${values}`;
			}
			return `- type=${el.type}; label="${el.label}"; slug=${slug}; values: ${values}`;
		})
		.join('\n');
}

function designContextBlocks(input: BuildPromptInput): string {
	const componentBlock =
		input.components.length === 0
			? '(none)'
			: input.components
					.map((c) => {
						const props = parseComponentProps(c).join(', ') || '(none)';
						return `### ${c.name}${c.description ? ` — ${c.description}` : ''}\nrole: ${c.role}; slots: [${props}]`;
					})
					.join('\n\n');

	const logoAssets = input.assets.filter((a) => a.kind === 'logo');
	const logoPair = pickEmailLogos(logoAssets);
	const nonLogoAssets = input.assets.filter((a) => a.kind !== 'logo');

	const logoBlock = logoPair
		? [
				`- [logo/light] ${logoPair.light.name} → ${input.assetBaseUrl}/api/design-asset/${logoPair.light.id}`,
				`- [logo/dark] ${logoPair.dark.name} → ${input.assetBaseUrl}/api/design-asset/${logoPair.dark.id}`,
			].join('\n')
		: '(no logos)';

	const otherAssetBlock =
		nonLogoAssets.length === 0
			? '(none)'
			: nonLogoAssets
					.map((a) => `- [${a.kind}] ${a.name} → ${input.assetBaseUrl}/api/design-asset/${a.id}`)
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
		`# Email formatting rules (tone and structure guidance for copy)`,
		EMAIL_FORMATTING_RULES.trim(),
		``,
		`# Library sections available (structure is fixed — fill their slots with copy)`,
		componentBlock,
		``,
		`# Logos`,
		logoBlock,
		``,
		`# Other assets`,
		otherAssetBlock,
		``,
		`# Chosen sections (in order)`,
		required.length ? elementLines(required, input.assetBaseUrl, input) : '(none required)',
		``,
		`# Optional sections`,
		optional.length ? elementLines(optional, input.assetBaseUrl, input) : '(none)',
		``,
		`# Allowed slot keys (use ONLY these keys in "slots")`,
		input.expectedSlots.length ? input.expectedSlots.join(', ') : '(none)',
		``,
		`# User prompt`,
		input.prompt.trim() || '(no additional instructions)',
	].join('\n');
}

export function buildScaffoldMessages(input: BuildPromptInput): Array<{
	role: 'system' | 'user';
	content: string;
}> {
	const system = [
		'You write copy and slot values for an email template.',
		'Return ONLY valid JSON (no markdown fences, no commentary) with this shape:',
		'{ "subject"?: string, "preheader"?: string, "slots": { "<slotName>": "<value>" } }',
		'Rules:',
		'- Fill every meaningful slot for the chosen sections with short, email-ready copy.',
		'- Use ONLY slot keys from the Allowed slot keys list. Extra keys are rejected.',
		'- For URL slots, use real https:// URLs or leave empty if unknown.',
		'- For image/logo URL slots that already have design-system assets listed, copy those URLs into the slots.',
		'- preheader: one short preview sentence (≤90 chars).',
		'- subject: optional override of the template subject.',
		'- Do NOT invent HTML, CSS, or Svelte. Text values only.',
		'- Keep paragraphs short (1–3 sentences). One clear primary CTA label.',
	].join(' ');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: designContextBlocks(input) },
	];
}

function stripMarkdownFences(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fenced ? fenced[1].trim() : trimmed;
}

export function parseScaffoldJson(raw: string, expectedSlots: string[]): ScaffoldContent {
	const cleaned = stripMarkdownFences(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		const match = cleaned.match(/\{[\s\S]*\}/);
		if (!match) throw new Error('Scaffold did not return valid JSON');
		parsed = JSON.parse(match[0]);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Scaffold JSON must be an object');
	}

	const obj = parsed as Record<string, unknown>;
	const expected = new Set(expectedSlots);
	const slots: Record<string, string> = {};

	const slotSrc =
		obj.slots && typeof obj.slots === 'object' && !Array.isArray(obj.slots)
			? (obj.slots as Record<string, unknown>)
			: {};

	for (const [key, value] of Object.entries(slotSrc)) {
		if (typeof value !== 'string') continue;
		if (expected.size > 0 && !expected.has(key)) continue;
		slots[key] = value;
	}

	// Also accept flat keys at top level
	for (const [key, value] of Object.entries(obj)) {
		if (key === 'subject' || key === 'preheader' || key === 'slots') continue;
		if (typeof value !== 'string') continue;
		if (expected.size > 0 && !expected.has(key)) continue;
		if (!(key in slots)) slots[key] = value;
	}

	return {
		subject: typeof obj.subject === 'string' ? obj.subject.trim() || undefined : undefined,
		preheader: typeof obj.preheader === 'string' ? obj.preheader.trim() || undefined : undefined,
		slots,
	};
}

export type GenerateProgressEvent =
	| { stage: 'preparing'; message: string }
	| { stage: 'calling_model'; message: string; model: string }
	| { stage: 'delta'; delta: string; chars: number }
	| { stage: 'saving'; message: string }
	| { stage: 'done'; message: string }
	| { stage: 'error'; message: string }
	| { stage: 'cancelled'; message: string };

export type GenerateScaffoldOptions = {
	teamId: number;
	domainId?: number;
	templateId: string;
	prompt: string;
	assetBaseUrl?: string;
	signal?: AbortSignal;
	onProgress?: (event: GenerateProgressEvent) => void;
};

/**
 * AI fills slot values (copy) for the chosen sections. Does NOT write HTML.
 * Persists JSON to templates.content and optionally updates subject.
 * Streams OpenRouter tokens via onProgress when provided.
 */
export async function generateScaffold(opts: GenerateScaffoldOptions): Promise<{
	template: Template;
	scaffold: ScaffoldContent;
}> {
	const emit = (event: GenerateProgressEvent) => opts.onProgress?.(event);

	if (opts.signal?.aborted) {
		throw new DOMException('Generation cancelled', 'AbortError');
	}

	emit({ stage: 'preparing', message: 'Loading design system, sections, and expected slots…' });

	const template = getTemplate(opts.templateId, opts.teamId, opts.domainId);
	const bundle = getDesignSystemBundle(opts.teamId);
	const elements = listElements(opts.templateId, opts.teamId, opts.domainId);
	const assetBaseUrl = (opts.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');
	const expectedSlots = collectExpectedSlots(elements, bundle.components);

	if (elements.length === 0) {
		throw new Error('Add at least one section before generating content');
	}

	const promptInput: BuildPromptInput = {
		template,
		designMd: bundle.system?.designMd ?? null,
		components: bundle.components,
		assets: bundle.assets,
		elements,
		prompt: opts.prompt,
		assetBaseUrl,
		expectedSlots,
	};

	const model = openRouterModel();
	emit({
		stage: 'calling_model',
		message: `Streaming scaffold JSON from ${model}…`,
		model,
	});

	const raw = await openRouterChat(buildScaffoldMessages(promptInput), {
		signal: opts.signal,
		stream: true,
		jsonObject: true,
		onDelta: (delta, chars) => {
			emit({ stage: 'delta', delta, chars });
		},
	});

	if (!raw?.trim()) {
		throw new Error('Scaffold returned empty content');
	}

	emit({ stage: 'saving', message: 'Parsing and saving slot values…' });

	const scaffold = parseScaffoldJson(raw, expectedSlots);

	// Preserve logos from design system if the model omitted them
	const logoAssets = bundle.assets.filter((a) => a.kind === 'logo');
	const logoPair = pickEmailLogos(logoAssets);
	if (logoPair) {
		// Persist relative paths — absolutize only at send time.
		const light = `/api/design-asset/${logoPair.light.id}`;
		const dark = `/api/design-asset/${logoPair.dark.id}`;
		if (!scaffold.slots.logo_url) scaffold.slots.logo_url = light;
		if (!scaffold.slots.logo) scaffold.slots.logo = light;
		if (!scaffold.slots.logo_dark_url) scaffold.slots.logo_dark_url = dark;
		if (!scaffold.slots.logo_dark) scaffold.slots.logo_dark = dark;
	}
	for (const [key, value] of Object.entries(scaffold.slots)) {
		if (typeof value === 'string') scaffold.slots[key] = relativizeDesignAssetUrls(value);
	}

	const existingParsed = parseEmailBuilderContent(template.content);
	const existing = existingParsed.scaffold.slots
		? existingParsed.scaffold
		: parseScaffoldContent(template.content);
	const merged: ScaffoldContent = {
		subject: scaffold.subject ?? existing.subject,
		preheader: scaffold.preheader ?? existing.preheader,
		slots: { ...existing.slots, ...scaffold.slots },
	};

	const designSnapshot = JSON.stringify({
		designMd: bundle.system?.designMd ?? null,
		components: bundle.components.map((c) => ({
			id: c.id,
			name: c.name,
			kind: c.kind,
			role: c.role,
			starterKey: c.starterKey,
			props: c.props,
		})),
		elements,
		scaffold: merged,
	});

	const content = existingParsed.document
		? serializeEmailBuilderContent(existingParsed.document, merged)
		: serializeScaffoldContent(merged);

	const updated = db
		.update(templates)
		.set({
			content,
			...(merged.subject ? { subject: merged.subject } : {}),
			prompt: opts.prompt,
			designSnapshot,
			updatedAt: nowIso(),
		})
		.where(eq(templates.id, template.id))
		.returning()
		.get();

	emit({ stage: 'done', message: 'Scaffold saved.' });
	return { template: updated, scaffold: merged };
}

/** @deprecated Prefer generateScaffold. Kept as alias during transition. */
export async function generateTemplateHtml(opts: GenerateScaffoldOptions): Promise<Template> {
	const { template } = await generateScaffold(opts);
	return template;
}
