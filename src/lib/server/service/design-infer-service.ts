import {
	addAsset,
	getComponent,
	getDesignSystem,
	parseComponentDocument,
	parseComponentSlots,
	upsertComponent,
	upsertDesignMd,
	type DesignComponent,
	type DesignSystem,
} from './design-system-service';
import { openRouterChat, openRouterModel } from './openrouter';
import {
	assertSafeUrl,
	downloadAssetBytes,
	extractFontCssUrls,
	extractLogoUrl,
	fetchCssText,
	parseFontFaces,
	uniqueFontsByFamily,
} from './design-asset-fetch-service';

const MAX_PAGE_CHARS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

function stripHtmlNoise(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function fetchPageHtml(url: URL): Promise<{ raw: string; text: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url.toString(), {
			signal: controller.signal,
			redirect: 'follow',
			headers: {
				'User-Agent': 'OwleryDesignInfer/1.0',
				Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
			},
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch URL (${response.status})`);
		}
		const contentType = response.headers.get('content-type') ?? '';
		if (
			contentType &&
			!contentType.includes('text/html') &&
			!contentType.includes('application/xhtml') &&
			!contentType.includes('text/plain')
		) {
			throw new Error('URL did not return HTML');
		}
		const raw = await response.text();
		const cleaned = stripHtmlNoise(raw);
		if (!cleaned) {
			throw new Error('Page content was empty after cleanup');
		}
		return { raw, text: cleaned.slice(0, MAX_PAGE_CHARS) };
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw new Error('Timed out fetching URL');
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

function stripMarkdownFences(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
	return fenced ? fenced[1].trim() : trimmed;
}

type InferPayload = {
	designMd: string;
};

function parseInferPayload(raw: string): InferPayload {
	const text = stripMarkdownFences(raw);
	try {
		const parsed = JSON.parse(text) as { designMd?: unknown };
		if (typeof parsed.designMd === 'string' && parsed.designMd.trim()) {
			return { designMd: parsed.designMd };
		}
		throw new Error('missing designMd');
	} catch {
		// Model sometimes returns bare markdown — treat whole response as design.md
		if (text.includes('#') || text.length > 40) {
			return { designMd: text };
		}
		throw new Error('AI returned an unreadable design system payload');
	}
}

export type InferProgressEvent =
	| { stage: 'preparing'; message: string }
	| { stage: 'fetching'; message: string }
	| { stage: 'calling_model'; message: string; model: string }
	| { stage: 'delta'; delta: string; chars: number }
	| { stage: 'saving'; message: string }
	| { stage: 'done'; message: string }
	| { stage: 'error'; message: string }
	| { stage: 'cancelled'; message: string };

export type InferDesignOptions = {
	teamId: number;
	rawUrl: string;
	signal?: AbortSignal;
	onProgress?: (event: InferProgressEvent) => void;
};

async function downloadLogoAndFonts(
	teamId: number,
	rawHtml: string,
	pageUrl: URL,
): Promise<number> {
	let assetsDownloaded = 0;

	const logoUrl = extractLogoUrl(rawHtml, pageUrl);
	if (logoUrl) {
		try {
			const asset = await downloadAssetBytes(logoUrl, { fallbackFilename: 'logo.png' });
			await addAsset(teamId, {
				kind: 'logo',
				name: 'Logo',
				filename: asset.filename,
				mime: asset.mime,
				bytes: asset.bytes,
			});
			assetsDownloaded += 1;
		} catch {
			// Non-fatal: continue with fonts
		}
	}

	const cssUrls = extractFontCssUrls(rawHtml, pageUrl);
	const allFaces = [];
	for (const cssUrl of cssUrls) {
		try {
			const css = await fetchCssText(cssUrl);
			allFaces.push(...parseFontFaces(css, cssUrl));
		} catch {
			// Non-fatal: skip this stylesheet
		}
	}

	const fonts = uniqueFontsByFamily(allFaces).slice(0, 6);
	for (const face of fonts) {
		try {
			const asset = await downloadAssetBytes(face.url, {
				fallbackFilename: `${face.family.replace(/\s+/g, '_')}.woff2`,
				formatHint: face.format,
			});
			await addAsset(teamId, {
				kind: 'font',
				name: face.family,
				filename: asset.filename,
				mime: asset.mime,
				bytes: asset.bytes,
			});
			assetsDownloaded += 1;
		} catch {
			// Non-fatal: skip this font
		}
	}

	return assetsDownloaded;
}

export async function inferDesignSystemFromUrl(
	teamIdOrOpts: number | InferDesignOptions,
	rawUrlMaybe?: string,
): Promise<{ system: DesignSystem; assetsDownloaded: number }> {
	const opts: InferDesignOptions =
		typeof teamIdOrOpts === 'number'
			? { teamId: teamIdOrOpts, rawUrl: String(rawUrlMaybe ?? '') }
			: teamIdOrOpts;
	const emit = (event: InferProgressEvent) => opts.onProgress?.(event);

	emit({ stage: 'preparing', message: 'Preparing design inference…' });
	const url = assertSafeUrl(opts.rawUrl.trim());
	emit({ stage: 'fetching', message: `Fetching ${url.toString()}…` });
	const { raw, text: pageText } = await fetchPageHtml(url);

	const systemPrompt = [
		'You extract a brand design system suitable for email templates from a website page.',
		'Return ONLY valid JSON (no markdown fences) with this shape:',
		'{ "designMd": string }',
		'designMd must be a markdown document covering: brand voice, colors (hex), typography, spacing, buttons, links, logo usage, and email-friendly layout notes.',
		'Do not invent or return email components — components are managed separately.',
	].join(' ');

	const userPrompt = [
		`Source URL: ${url.toString()}`,
		'',
		'Page content (scripts/styles removed, truncated):',
		pageText,
	].join('\n');

	const model = openRouterModel();
	emit({
		stage: 'calling_model',
		message: `Streaming design system from ${model}…`,
		model,
	});

	const rawAi = await openRouterChat(
		[
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		],
		{
			signal: opts.signal,
			teamId: opts.teamId,
			stream: true,
			onDelta: (delta, chars) => {
				emit({ stage: 'delta', delta, chars });
			},
		},
	);

	if (!rawAi?.trim()) {
		throw new Error('OpenRouter returned empty content');
	}

	emit({ stage: 'saving', message: 'Parsing response and saving design system…' });

	const payload = parseInferPayload(rawAi);
	const system = upsertDesignMd(opts.teamId, payload.designMd.trim());
	const assetsDownloaded = await downloadLogoAndFonts(opts.teamId, raw, url);

	emit({
		stage: 'done',
		message: `Saved design.md (${assetsDownloaded} assets downloaded). Components were not changed.`,
	});
	return { system, assetsDownloaded };
}

export type ReapplyProgressEvent =
	| { stage: 'preparing'; message: string }
	| { stage: 'calling_model'; message: string; model: string }
	| { stage: 'delta'; delta: string; chars: number }
	| { stage: 'saving'; message: string }
	| { stage: 'done'; message: string }
	| { stage: 'error'; message: string }
	| { stage: 'cancelled'; message: string };

export type ReapplyDesignOptions = {
	teamId: number;
	componentId: string;
	signal?: AbortSignal;
	onProgress?: (event: ReapplyProgressEvent) => void;
};

/**
 * Restyle one library component's block-tree document so visuals match design.md,
 * while preserving structure and slot pointers.
 */
export async function reapplyDesignSystemToComponent(
	teamIdOrOpts: number | ReapplyDesignOptions,
	componentIdMaybe?: string,
): Promise<DesignComponent> {
	const opts: ReapplyDesignOptions =
		typeof teamIdOrOpts === 'number'
			? { teamId: teamIdOrOpts, componentId: String(componentIdMaybe ?? '') }
			: teamIdOrOpts;
	const emit = (event: ReapplyProgressEvent) => opts.onProgress?.(event);

	emit({ stage: 'preparing', message: 'Loading component and design.md…' });
	const component = getComponent(opts.componentId, opts.teamId);
	const system = getDesignSystem(opts.teamId);
	const designMd = system?.designMd?.trim() ?? '';
	if (!designMd) {
		throw new Error('Save design.md before reapplying the design system');
	}

	const document = parseComponentDocument(component);
	if (!document) {
		throw new Error('Component has no block-tree document to restyle');
	}
	const slots = parseComponentSlots(component);

	const systemPrompt = [
		'You restyle a reusable email component so it matches a brand design system.',
		'The component is an email-builder JSON document (TEditorConfiguration).',
		'Return ONLY valid JSON (no markdown fences) with this shape:',
		'{ "document": <TEditorConfiguration> }',
		'Preserve every block id, type, childrenIds, and prop keys. Update colors, typography, spacing, and other visual style fields to match design.md.',
		'Do not invent new blocks or rename ids.',
	].join(' ');

	const userPrompt = [
		`Component name: ${component.name}`,
		component.description ? `Description: ${component.description}` : null,
		slots.length > 0 ? `slots: ${JSON.stringify(slots)}` : null,
		'',
		'## design.md',
		designMd,
		'',
		'## Current document',
		JSON.stringify(document, null, 2),
	]
		.filter((line): line is string => line != null)
		.join('\n');

	const model = openRouterModel();
	emit({
		stage: 'calling_model',
		message: `Streaming restyle from ${model}…`,
		model,
	});

	const rawAi = await openRouterChat(
		[
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		],
		{
			signal: opts.signal,
			teamId: opts.teamId,
			stream: true,
			onDelta: (delta, chars) => {
				emit({ stage: 'delta', delta, chars });
			},
		},
	);

	emit({ stage: 'saving', message: 'Saving updated component…' });
	const stripped = stripMarkdownFences(rawAi).trim();
	let nextDocument = document;
	try {
		const parsed = JSON.parse(stripped) as { document?: typeof document };
		if (parsed?.document && typeof parsed.document === 'object' && parsed.document.root) {
			nextDocument = parsed.document;
		} else if ((parsed as typeof document).root) {
			nextDocument = parsed as typeof document;
		} else {
			throw new Error('missing document');
		}
	} catch {
		throw new Error('AI returned invalid component document JSON');
	}

	const updated = upsertComponent(opts.teamId, {
		id: component.id,
		name: component.name,
		kind: 'custom',
		role: component.role,
		description: component.description,
		document: nextDocument,
		slots,
	});
	emit({ stage: 'done', message: 'Component updated.' });
	return updated;
}
