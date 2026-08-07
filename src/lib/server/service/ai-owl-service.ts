/**
 * Owl AI v2 — copy/scaffold generation for the Owl studio.
 *
 * Given an `OwlDoc` (and optionally a single section), streams a JSON
 * `{ subject?, preheader?, slots }` from OpenRouter and returns it merged
 * with design-system logo defaults. Deterministic parsing: unknown slot keys
 * are rejected against the allowed set extracted from the document.
 */
import { relativizeDesignAssetUrls } from '$lib/design-asset-urls';
import { pickEmailLogo, parseDesignTokenMap } from '$lib/design/extractTokens';
import { EMAIL_FORMATTING_RULES } from '../email-formatting-rules';
import { env } from '../env';
import { slotsFromFragment } from '$lib/email/owl/slots';
import type { OwlDoc } from '$lib/email/owl/studio';
import { newSectionId } from '$lib/email/owl/studio';
import { getDesignSystemBundle, listOwlSectionComponents, parseComponentProps } from './design-system-service';
import { openRouterChat, openRouterModel } from './openrouter';

export type GenerateProgressEvent =
	| { stage: 'preparing'; message: string }
	| { stage: 'system'; system: string }
	| { stage: 'context'; context: string }
	| { stage: 'calling_model'; message: string; model: string }
	| { stage: 'delta'; delta: string; chars: number }
	| { stage: 'saving'; message: string }
	| { stage: 'done'; message: string }
	| { stage: 'error'; message: string }
	| { stage: 'cancelled'; message: string };

export type OwlAiSectionContext = {
	id: string;
	label: string;
	key: string;
	slots: Array<{ name: string; type: string; label?: string }>;
};

export type OwlAiResult = {
	subject?: string;
	preheader?: string;
	slots: Record<string, string>;
	model: string;
};

export type OwlAiOptions = {
	teamId: number;
	templateName?: string;
	doc: OwlDoc;
	prompt: string;
	assetBaseUrl?: string;
	/** When set, only this section's slots are writable. */
	sectionId?: string;
	signal?: AbortSignal;
	onProgress?: (event: GenerateProgressEvent) => void;
};

/** Extract declared slots from every section of the document. */
export function owlSectionContexts(doc: OwlDoc): OwlAiSectionContext[] {
	return doc.sections.map((s) => ({
		id: s.id,
		label: s.label,
		key: s.key,
		slots: slotsFromFragment(s.html).map((slot) => ({
			name: slot.name,
			type: slot.type,
			label: slot.label,
		})),
	}));
}

/** Unique slot names across the given sections (or the whole doc). */
export function collectOwlSlotNames(contexts: OwlAiSectionContext[]): string[] {
	return [...new Set(contexts.flatMap((c) => c.slots.map((s) => s.name)))];
}

function stripMarkdownFences(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parse the model's JSON response into a ScaffoldContent, keeping only
 * slot keys from the allowed set. Tolerates markdown fences and stray text.
 */
export function parseScaffoldJson(
	raw: string,
	expectedSlots: string[],
): { subject?: string; preheader?: string; slots: Record<string, string> } {
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

type BuildInput = {
	templateName: string;
	templateSubject: string;
	designMd: string | null;
	components: Array<{
		id: string;
		name: string;
		description: string | null;
		role: string;
		props: string;
		starterKey: string | null;
		source?: 'starter' | 'design';
	}>;
	assets: Array<{ id: string; kind: string; name: string; filename: string }>;
	contexts: OwlAiSectionContext[];
	targetLabel: string;
	prompt: string;
	assetBaseUrl: string;
	expectedSlots: string[];
};

function sectionLines(contexts: OwlAiSectionContext[]): string {
	return contexts
		.map((ctx) => {
			const slots = ctx.slots.length
				? ctx.slots.map((s) => `${s.name}(${s.type}${s.label ? `: ${s.label}` : ''})`).join(', ')
				: '(none)';
			return `- [${ctx.key}] ${ctx.label}; slots: ${slots}`;
		})
		.join('\n');
}

function designContextBlocks(input: BuildInput): string {
	const componentBlock =
		input.components.length === 0
			? '(none)'
			: input.components
					.map((c) => {
						const props = c.props || '(none)';
						const tag = c.source === 'design' ? 'saved component' : 'library';
						return `### ${c.name}${c.description ? ` — ${c.description}` : ''}\nrole: ${c.role}; slots: [${props}] (${tag})`;
					})
					.join('\n\n');

	const logoAssets = input.assets.filter((a) => a.kind === 'logo');
	const primaryLogo = pickEmailLogo(logoAssets);
	const nonLogoAssets = input.assets.filter((a) => a.kind !== 'logo');

	const logoBlock = primaryLogo
		? `- [logo] ${primaryLogo.name} → /api/design-asset/${primaryLogo.id}`
		: '(no logos)';

	const otherAssetBlock =
		nonLogoAssets.length === 0
			? '(none)'
			: nonLogoAssets
					.map((a) => `- [${a.kind}] ${a.name} → /api/design-asset/${a.id}`)
					.join('\n');

	return [
		`# Template`,
		`Name: ${input.templateName}`,
		`Subject: ${input.templateSubject}`,
		``,
		`# Copy target`,
		input.targetLabel,
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
		`# Sections in the email (in order)`,
		sectionLines(input.contexts),
		``,
		`# Allowed slot keys (use ONLY these keys in "slots")`,
		input.expectedSlots.length ? input.expectedSlots.join(', ') : '(none)',
		``,
		`# User prompt`,
		input.prompt.trim() || '(no additional instructions)',
	].join('\n');
}

export function buildOwlScaffoldMessages(input: BuildInput): Array<{
	role: 'system' | 'user';
	content: string;
}> {
	const system = [
		'You write copy and slot values for an email template composed of annotated HTML sections.',
		'Return ONLY valid JSON (no markdown fences, no commentary) with this shape:',
		'{ "subject"?: string, "preheader"?: string, "slots": { "<slotName>": "<value>" } }',
		'Rules:',
		'- Fill every meaningful slot for the copy target with short, email-ready copy.',
		'- Text slots support Markdown (**bold**, *italic*, [links](https://…), lists).',
		'- Use ONLY slot keys from the Allowed slot keys list. Extra keys are rejected.',
		'- For URL slots, use real https:// URLs or leave the value empty if unknown.',
		'- For image/logo slots, copy the relative /api/design-asset/... URLs listed under Logos/Other assets.',
		'- preheader: one short preview sentence (≤90 chars).',
		'- subject: optional override of the template subject (marketing style, ≤60 chars).',
		'- Do NOT invent HTML, CSS, or Svelte. Text values only.',
		'- Keep paragraphs short (1–3 sentences). One clear primary CTA label.',
	].join(' ');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: designContextBlocks(input) },
	];
}

/**
 * Generate copy for an OwlDoc (or one of its sections). Streams OpenRouter
 * tokens via onProgress and returns subject/preheader/slot values. Does not
 * write to the database — callers apply the result to their document.
 */
export async function generateOwlScaffold(opts: OwlAiOptions): Promise<OwlAiResult> {
	const emit = (event: GenerateProgressEvent) => opts.onProgress?.(event);

	if (opts.signal?.aborted) {
		throw new DOMException('Generation cancelled', 'AbortError');
	}

	emit({ stage: 'preparing', message: 'Reading sections, slots, and design system…' });

	const bundle = getDesignSystemBundle(opts.teamId);
	const contexts = owlSectionContexts(opts.doc);
	const target = opts.sectionId ? contexts.find((c) => c.id === opts.sectionId) : undefined;
	if (opts.sectionId && !target) {
		throw new Error('Section not found in the current document');
	}

	const expectedSlots = target ? target.slots.map((s) => s.name) : collectOwlSlotNames(contexts);
	const assetBaseUrl = (opts.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');

	const owlLibrary = listOwlSectionComponents(opts.teamId);
	const libraryForPrompt =
		owlLibrary.length > 0
			? owlLibrary
			: bundle.components.filter((c) => c.html?.trim());

	const input: BuildInput = {
		templateName: opts.templateName ?? 'Owl email',
		templateSubject: '(set in template settings)',
		designMd: bundle.system?.designMd ?? null,
		components: libraryForPrompt.map((c) => ({
			id: c.id,
			name: c.name,
			description: c.description,
			role: c.role,
			props: slotsFromFragment(c.html)
				.map((s) => s.name)
				.join(', ') || parseComponentProps(c).join(', '),
			starterKey: c.starterKey,
			source: 'design' as const,
		})),
		assets: bundle.assets.map((a) => ({
			id: a.id,
			kind: a.kind,
			name: a.name,
			filename: a.filename,
		})),
		contexts,
		targetLabel: target
			? `Section "${target.label}" — write copy for this section only.`
			: 'The whole email — write copy for every section.',
		prompt: opts.prompt,
		assetBaseUrl,
		expectedSlots,
	};

	const model = openRouterModel();
	const messages = buildOwlScaffoldMessages(input);
	emit({ stage: 'system', system: messages[0].content });
	emit({ stage: 'context', context: messages[1].content });
	emit({ stage: 'calling_model', message: `Streaming copy from ${model}…`, model });

	const raw = await openRouterChat(messages, {
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

	emit({ stage: 'saving', message: 'Validating slot values…' });

	const scaffold = parseScaffoldJson(raw, expectedSlots);

	const logoAssets = bundle.assets.filter((a) => a.kind === 'logo');
	const primaryLogo = pickEmailLogo(logoAssets);
	if (primaryLogo) {
		const src = `/api/design-asset/${primaryLogo.id}`;
		if (!scaffold.slots.logo_url) scaffold.slots.logo_url = src;
		if (!scaffold.slots.logo) scaffold.slots.logo = src;
	}
	for (const [key, value] of Object.entries(scaffold.slots)) {
		if (typeof value === 'string') scaffold.slots[key] = relativizeDesignAssetUrls(value);
	}

	return {
		subject: scaffold.subject,
		preheader: scaffold.preheader,
		slots: scaffold.slots,
		model,
	};
}

// --- Full-template compose (build sections + copy from description) ---

export type OwlCatalogSection = {
	key: string;
	name: string;
	description: string;
	html: string;
	slots: Array<{ name: string; type: string; label?: string }>;
	source: 'starter' | 'design';
};

export type OwlComposeSectionSpec = {
	key: string;
	label?: string;
	slots?: Record<string, string>;
};

export type OwlComposeParsed = {
	subject?: string;
	preheader?: string;
	sections: OwlComposeSectionSpec[];
};

export type OwlComposeOptions = {
	teamId: number;
	templateName: string;
	templateSubject: string;
	description: string;
	shellHtml: string;
	catalog: OwlCatalogSection[];
	signal?: AbortSignal;
	onProgress?: (event: GenerateProgressEvent) => void;
};

export function buildOwlCatalog(
	starters: Array<{ key: string; name: string; description: string; role: string; html: string }>,
	designSections: Array<{ id: string; name: string; description: string | null; html: string }>,
): OwlCatalogSection[] {
	const out: OwlCatalogSection[] = [];
	for (const s of starters) {
		if (s.role !== 'section' || !s.html?.trim()) continue;
		out.push({
			key: s.key,
			name: s.name,
			description: s.description,
			html: s.html,
			slots: slotsFromFragment(s.html).map((slot) => ({
				name: slot.name,
				type: slot.type,
				label: slot.label,
			})),
			source: 'starter',
		});
	}
	for (const d of designSections) {
		if (!d.html?.trim()) continue;
		out.push({
			key: d.id,
			name: d.name,
			description: d.description ?? '',
			html: d.html,
			slots: slotsFromFragment(d.html).map((slot) => ({
				name: slot.name,
				type: slot.type,
				label: slot.label,
			})),
			source: 'design',
		});
	}
	return out;
}

export function parseComposeJson(raw: string, allowedKeys: string[]): OwlComposeParsed {
	const cleaned = stripMarkdownFences(raw);
	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch {
		const match = cleaned.match(/\{[\s\S]*\}/);
		if (!match) throw new Error('Compose did not return valid JSON');
		parsed = JSON.parse(match[0]);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Compose JSON must be an object');
	}

	const obj = parsed as Record<string, unknown>;
	const allowed = new Set(allowedKeys);
	const sectionsRaw = obj.sections;
	if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) {
		throw new Error('Compose JSON must include a non-empty "sections" array');
	}

	const sections: OwlComposeSectionSpec[] = [];
	for (const item of sectionsRaw) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const spec = item as Record<string, unknown>;
		const key = typeof spec.key === 'string' ? spec.key.trim() : '';
		if (!key || !allowed.has(key)) {
			throw new Error(`Unknown or missing section key: ${key || '(empty)'}`);
		}
		const slots: Record<string, string> = {};
		if (spec.slots && typeof spec.slots === 'object' && !Array.isArray(spec.slots)) {
			for (const [k, v] of Object.entries(spec.slots as Record<string, unknown>)) {
				if (typeof v === 'string') slots[k] = v;
			}
		}
		sections.push({
			key,
			label: typeof spec.label === 'string' ? spec.label.trim() || undefined : undefined,
			slots: Object.keys(slots).length ? slots : undefined,
		});
	}

	if (sections.length === 0) throw new Error('Compose returned no valid sections');

	return {
		subject: typeof obj.subject === 'string' ? obj.subject.trim() || undefined : undefined,
		preheader: typeof obj.preheader === 'string' ? obj.preheader.trim() || undefined : undefined,
		sections,
	};
}

function catalogLines(catalog: OwlCatalogSection[]): string {
	return catalog
		.map((c) => {
			const slots = c.slots.length
				? c.slots.map((s) => `${s.name}(${s.type}${s.label ? `: ${s.label}` : ''})`).join(', ')
				: '(none)';
			return `- key="${c.key}" [${c.source}] ${c.name}${c.description ? ` — ${c.description}` : ''}; slots: ${slots}`;
		})
		.join('\n');
}

export function buildOwlComposeMessages(input: {
	templateName: string;
	templateSubject: string;
	description: string;
	designMd: string | null;
	catalog: OwlCatalogSection[];
	assets?: Array<{ id: string; kind: string; name: string; filename: string }>;
}): Array<{ role: 'system' | 'user'; content: string }> {
	const allowedKeys = input.catalog.map((c) => c.key);
	const tokenMap = parseDesignTokenMap(input.designMd ?? '');
	const tokenBlock =
		Object.keys(tokenMap).length === 0
			? '(none — use clean defaults)'
			: Object.entries(tokenMap)
					.map(([name, value]) => `- ${name}: ${value}`)
					.join('\n');

	const logoAssets = (input.assets ?? []).filter((a) => a.kind === 'logo');
	const primaryLogo = pickEmailLogo(logoAssets);
	const nonLogoAssets = (input.assets ?? []).filter((a) => a.kind !== 'logo');
	const logoBlock = primaryLogo
		? `- [logo] ${primaryLogo.name} → /api/design-asset/${primaryLogo.id}`
		: '(no logos)';
	const otherAssetBlock =
		nonLogoAssets.length === 0
			? '(none)'
			: nonLogoAssets.map((a) => `- [${a.kind}] ${a.name} → /api/design-asset/${a.id}`).join('\n');

	const system = [
		'You compose a complete marketing email template from a description.',
		'Return ONLY valid JSON (no markdown fences, no commentary) with this shape:',
		'{ "subject"?: string, "preheader"?: string, "sections": [{ "key": string, "label"?: string, "slots"?: { "<slotName>": "<value>" } }] }',
		'Rules:',
		'- Pick an ordered list of sections from the catalog using ONLY the listed key values.',
		'- Prefer design-system sections (source: design) when they match the email purpose.',
		'- Include 3–8 sections: logo/header, hero or heading, body text, CTA, footer as appropriate.',
		'- Fill every meaningful slot with short, email-ready copy.',
		'- Text slots support Markdown (**bold**, *italic*, [links](https://…), lists).',
		'- Use brand colors from the design system for color slots and CTA styling when available.',
		'- For logo/image URL slots, use the /api/design-asset/... URLs listed under Logos/Other assets.',
		'- Slot keys must match the catalog entry for that section.',
		'- preheader: one short preview sentence (≤90 chars).',
		'- subject: optional override (≤60 chars).',
		'- Do NOT invent HTML or CSS. Text/URL values only.',
	].join(' ');

	const user = [
		`# Template`,
		`Name: ${input.templateName}`,
		`Subject: ${input.templateSubject}`,
		``,
		`# Description`,
		input.description.trim() || '(no description — infer a sensible marketing email)',
		``,
		`# Design system (design.md)`,
		input.designMd?.trim() || '(empty — use a clean, modern default)',
		``,
		`# Brand tokens (use for color slots and tone)`,
		tokenBlock,
		``,
		`# Logos`,
		logoBlock,
		``,
		`# Other assets`,
		otherAssetBlock,
		``,
		`# Email formatting rules`,
		EMAIL_FORMATTING_RULES.trim(),
		``,
		`# Section catalog (use ONLY these keys in "sections[].key")`,
		catalogLines(input.catalog),
		``,
		`# Allowed section keys`,
		allowedKeys.join(', ') || '(none)',
	].join('\n');

	return [
		{ role: 'system', content: system },
		{ role: 'user', content: user },
	];
}

export function assembleOwlDocFromCompose(
	compose: OwlComposeParsed,
	catalog: OwlCatalogSection[],
	shellHtml: string,
): OwlDoc {
	const byKey = new Map(catalog.map((c) => [c.key, c]));
	const slotValues: Record<string, string> = {};
	const sections: OwlDoc['sections'] = [];

	for (const spec of compose.sections) {
		const meta = byKey.get(spec.key);
		if (!meta?.html?.trim()) throw new Error(`Section not in catalog: ${spec.key}`);
		sections.push({
			id: newSectionId(),
			key: spec.key,
			label: spec.label ?? meta.name,
			html: meta.html,
		});
		if (spec.slots) {
			for (const [name, value] of Object.entries(spec.slots)) {
				if (typeof value === 'string') slotValues[name] = value;
			}
		}
	}

	return {
		owl: 'v1',
		shell: shellHtml,
		sections,
		preheader: compose.preheader,
		slotValues,
	};
}

export type OwlComposeResult = {
	doc: OwlDoc;
	subject?: string;
	preheader?: string;
	model: string;
};

/**
 * Build a full OwlDoc from template name/subject/description. Picks sections
 * from the catalog, orders them, and fills slot values + preheader.
 */
export async function generateOwlCompose(opts: OwlComposeOptions): Promise<OwlComposeResult> {
	const emit = (event: GenerateProgressEvent) => opts.onProgress?.(event);

	if (opts.signal?.aborted) {
		throw new DOMException('Generation cancelled', 'AbortError');
	}

	if (opts.catalog.length === 0) {
		throw new Error('No sections available in the library');
	}

	emit({ stage: 'preparing', message: 'Reading catalog and design system…' });

	const bundle = getDesignSystemBundle(opts.teamId);
	const allowedKeys = opts.catalog.map((c) => c.key);

	const input = {
		templateName: opts.templateName,
		templateSubject: opts.templateSubject,
		description: opts.description,
		designMd: bundle.system?.designMd ?? null,
		catalog: opts.catalog,
		assets: bundle.assets.map((a) => ({
			id: a.id,
			kind: a.kind,
			name: a.name,
			filename: a.filename,
		})),
	};

	const model = openRouterModel();
	const messages = buildOwlComposeMessages(input);
	emit({ stage: 'system', system: messages[0].content });
	emit({ stage: 'context', context: messages[1].content });
	emit({ stage: 'calling_model', message: `Composing template from ${model}…`, model });

	const raw = await openRouterChat(messages, {
		signal: opts.signal,
		stream: true,
		jsonObject: true,
		onDelta: (delta, chars) => {
			emit({ stage: 'delta', delta, chars });
		},
	});

	if (!raw?.trim()) throw new Error('Compose returned empty content');

	emit({ stage: 'saving', message: 'Assembling template…' });

	const parsed = parseComposeJson(raw, allowedKeys);
	const doc = assembleOwlDocFromCompose(parsed, opts.catalog, opts.shellHtml);

	// Apply logo default
	const logoAssets = bundle.assets.filter((a) => a.kind === 'logo');
	const primaryLogo = pickEmailLogo(logoAssets);
	if (primaryLogo) {
		const src = `/api/design-asset/${primaryLogo.id}`;
		if (!doc.slotValues.logo_url) doc.slotValues.logo_url = src;
		if (!doc.slotValues.logo) doc.slotValues.logo = src;
	}
	for (const [key, value] of Object.entries(doc.slotValues)) {
		if (typeof value === 'string') doc.slotValues[key] = relativizeDesignAssetUrls(value);
	}

	return {
		doc,
		subject: parsed.subject,
		preheader: parsed.preheader,
		model,
	};
}
