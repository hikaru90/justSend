/**
 * Canonical design-system context for AI create / edit / validate.
 *
 * Every design AI path (OpenRouter JSON component trees, Pi HTML workspaces,
 * reapply) should start from {@link buildDesignWorkspaceContext} so the agent
 * always gets the same brand library: design.md, formatting rules, assets,
 * peer components, and the target artifact — with mode-specific instructions.
 */
import { pickEmailLogos } from '$lib/design/extractTokens';
import { renderEmailHtml } from '$lib/email-builder/render';
import type { ComponentSlot, TEditorConfiguration } from '$lib/email-builder/types';
import type { DesignAssetKind } from '../db/schema';
import { EMAIL_FORMATTING_RULES } from '../email-formatting-rules';
import { env } from '../env';
import {
	getDesignSystemBundle,
	parseComponentDocument,
	parseComponentSlots,
	type DesignAsset,
	type DesignComponent,
} from './design-system-service';

export type DesignWorkspaceMode = 'create' | 'edit' | 'validate';

export type DesignAssetPromptRef = {
	id: string;
	kind: string;
	name: string;
	filename: string;
};

/**
 * Prompt-ready asset catalog with explicit light/dark logo URLs.
 * Shared by OpenRouter prompts and Pi HTML workspace README.
 */
export function formatDesignAssetsForPrompt(
	assets: DesignAssetPromptRef[],
	assetBaseUrl: string,
): string {
	const base = assetBaseUrl.replace(/\/$/, '');
	if (assets.length === 0) return '(no assets uploaded)';

	const logos = assets.filter((a) => a.kind === 'logo');
	const others = assets.filter((a) => a.kind !== 'logo');
	const pair = pickEmailLogos(logos);
	const lines: string[] = [];

	if (pair) {
		lines.push('Logos (use these exact embed URLs for logo/image swaps):');
		lines.push(`- [logo/light] ${pair.light.name} → ${base}/api/design-asset/${pair.light.id}`);
		lines.push(`- [logo/dark] ${pair.dark.name} → ${base}/api/design-asset/${pair.dark.id}`);
		const pairedIds = new Set([pair.light.id, pair.dark.id]);
		for (const a of logos) {
			if (!pairedIds.has(a.id)) {
				lines.push(`- [logo] ${a.name} → ${base}/api/design-asset/${a.id}`);
			}
		}
	} else {
		lines.push('Logos: (none)');
	}

	lines.push('');
	lines.push('Other assets:');
	if (others.length === 0) {
		lines.push('(none)');
	} else {
		for (const a of others) {
			lines.push(`- [${a.kind}] ${a.name} → ${base}/api/design-asset/${a.id}`);
		}
	}

	return lines.join('\n');
}

export type DesignWorkspaceLibraryComponent = {
	id: string;
	name: string;
	description: string | null;
	role: string;
	/** Rendered HTML (from stored html, or from document when html is empty). */
	html: string;
	slots: ComponentSlot[];
};

export type DesignWorkspaceTarget = {
	kind: 'component-tree';
	name?: string;
	description?: string | null;
	document: TEditorConfiguration;
	slots: ComponentSlot[];
	/** Exclude this library component from peer reference (the one being edited). */
	excludeComponentName?: string | null;
};

export type DesignWorkspaceContext = {
	mode: DesignWorkspaceMode;
	designMd: string;
	formattingRules: string;
	assets: DesignAssetPromptRef[];
	assetBaseUrl: string;
	/** Full asset rows when staging binaries into a Pi workdir. */
	assetRows: DesignAsset[];
	libraryComponents: DesignWorkspaceLibraryComponent[];
	target: DesignWorkspaceTarget;
};

/** Shape accepted by Pi on-disk design library staging. */
export type DesignWorkspacePiFilesInput = {
	designMd?: string | null;
	components?: Array<{ name: string; description?: string | null; html: string }>;
	assets?: Array<{
		id: string;
		kind: DesignAssetKind;
		name: string;
		filename: string;
		mime: string;
		size: number;
	}>;
	assetBaseUrl?: string;
	excludeComponentName?: string | null;
};

export function isEmptyComponentDocument(document: TEditorConfiguration): boolean {
	const children = document.root?.data?.childrenIds;
	return !Array.isArray(children) || children.length === 0;
}

/**
 * Resolve mode from an explicit client value, otherwise:
 * - empty document → create
 * - validate/check/review-style instruction → validate
 * - else → edit
 */
export function inferDesignWorkspaceMode(opts: {
	mode?: string | null;
	instruction: string;
	document: TEditorConfiguration;
}): DesignWorkspaceMode {
	const explicit = String(opts.mode ?? '')
		.trim()
		.toLowerCase();
	if (explicit === 'create' || explicit === 'edit' || explicit === 'validate') {
		return explicit;
	}

	const instruction = opts.instruction.trim().toLowerCase();
	if (
		/^(please\s+)?(validate|verify|check|audit|review|lint)\b/.test(instruction) ||
		/\b(validate|verify|audit)\s+(the\s+)?(component|document|blocks?|slots?|html)\b/.test(
			instruction,
		)
	) {
		return 'validate';
	}

	if (isEmptyComponentDocument(opts.document)) return 'create';
	return 'edit';
}

/** HTML for a library component: prefer stored html, else render from document. */
export function resolveLibraryComponentHtml(
	component: Pick<DesignComponent, 'html' | 'document' | 'name'>,
): string {
	const stored = component.html?.trim();
	if (stored) return stored;

	const document = parseComponentDocument(component);
	if (!document) return '';

	try {
		return renderEmailHtml(document).trim();
	} catch {
		return '';
	}
}

export function modeInstructionRules(mode: DesignWorkspaceMode): string {
	switch (mode) {
		case 'create':
			return [
				'Mode: CREATE',
				'- Build a new component from the instruction and the design library below.',
				'- Match design.md tokens, formatting rules, and patterns from peer components.',
				'- Use exact asset embed URLs from Assets when including logos/images.',
				'- Prefer marking copy and image fields as slots.',
				'- Invent a clear block tree; do not leave the document empty.',
			].join('\n');
		case 'validate':
			return [
				'Mode: VALIDATE',
				'- Do not redesign or rewrite the component.',
				'- Check the current document/slots against design.md, formatting rules, assets, and peer patterns.',
				'- Fix ONLY concrete problems (broken/missing asset URLs, wrong light/dark logo, invalid structure, missing required slots).',
				'- If everything is fine, return the current document and slots unchanged.',
				'- Prefer the smallest possible fix when something is wrong.',
			].join('\n');
		case 'edit':
		default:
			return [
				'Mode: EDIT',
				'- This is a MINIMAL DIFF of an existing component — not a redesign.',
				'- Change ONLY what the instruction asks for.',
				'- Leave every other block, prop, style, slot, childrenIds order, and copy untouched.',
				'- Preserve every existing block id and type unless the instruction explicitly requires adding/removing blocks.',
				'- For asset/image/logo swaps, update only the relevant URL fields using exact embed URLs from Assets.',
				'- You must return the full document JSON (schema requirement), but it must be the current document with only the requested fields changed.',
			].join('\n');
	}
}

export function formatLibraryComponentsForPrompt(
	components: DesignWorkspaceLibraryComponent[],
	opts?: { maxHtmlChars?: number },
): string {
	if (components.length === 0) return '(no peer components in the library)';

	const maxHtml = opts?.maxHtmlChars ?? 2500;
	return components
		.map((c) => {
			const slotNames = c.slots.map((s) => s.name).join(', ') || '(none)';
			const html =
				c.html.length > maxHtml
					? `${c.html.slice(0, maxHtml)}\n<!-- …truncated ${c.html.length - maxHtml} chars -->`
					: c.html;
			return [
				`### ${c.name}${c.description ? ` — ${c.description}` : ''}`,
				`role: ${c.role}; slots: [${slotNames}]`,
				html ? `\`\`\`html\n${html}\n\`\`\`` : '(no HTML preview)',
			].join('\n');
		})
		.join('\n\n');
}

export function buildDesignWorkspaceContext(opts: {
	teamId: number;
	mode: DesignWorkspaceMode;
	target: DesignWorkspaceTarget;
	assetBaseUrl?: string;
}): DesignWorkspaceContext {
	const bundle = getDesignSystemBundle(opts.teamId);
	const assetBaseUrl = (opts.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');
	const excludeName = opts.target.excludeComponentName?.trim() ?? opts.target.name?.trim() ?? '';

	const assets: DesignAssetPromptRef[] = bundle.assets.map((a) => ({
		id: a.id,
		kind: a.kind,
		name: a.name,
		filename: a.filename,
	}));

	const libraryComponents: DesignWorkspaceLibraryComponent[] = bundle.components
		.filter((c) => !excludeName || c.name !== excludeName)
		.map((c) => ({
			id: c.id,
			name: c.name,
			description: c.description,
			role: c.role,
			html: resolveLibraryComponentHtml(c),
			slots: parseComponentSlots(c),
		}))
		.filter((c) => c.html || c.slots.length > 0);

	return {
		mode: opts.mode,
		designMd: bundle.system?.designMd?.trim() ?? '',
		formattingRules: EMAIL_FORMATTING_RULES.trim(),
		assets,
		assetBaseUrl,
		assetRows: bundle.assets,
		libraryComponents,
		target: opts.target,
	};
}

/** Shared OpenRouter user prompt sections for any component-tree operation. */
export function buildDesignWorkspaceUserPrompt(
	ctx: DesignWorkspaceContext,
	instruction: string,
): string {
	const { target } = ctx;
	return [
		target.name ? `Component name: ${target.name}` : null,
		target.description ? `Description: ${target.description}` : null,
		`Mode: ${ctx.mode}`,
		'',
		'## Instruction',
		instruction.trim(),
		'',
		modeInstructionRules(ctx.mode),
		'',
		ctx.designMd
			? `## design.md\n${ctx.designMd}\n`
			: '## design.md\n(empty — use a clean default matching formatting rules)\n',
		'## Email formatting rules',
		ctx.formattingRules,
		'',
		'## Assets',
		formatDesignAssetsForPrompt(ctx.assets, ctx.assetBaseUrl),
		'',
		'## Peer library components (patterns — do not copy wholesale unless asked)',
		formatLibraryComponentsForPrompt(ctx.libraryComponents),
		'',
		'## Current document',
		JSON.stringify(target.document, null, 2),
		'',
		'## Current slots',
		JSON.stringify(target.slots, null, 2),
	]
		.filter((line): line is string => line != null)
		.join('\n');
}

/** Map workspace context into the Pi on-disk design library shape. */
export function toPiDesignContext(ctx: DesignWorkspaceContext): DesignWorkspacePiFilesInput {
	return {
		designMd: ctx.designMd || null,
		components: ctx.libraryComponents.map((c) => ({
			name: c.name,
			description: c.description,
			html: c.html,
		})),
		assets: ctx.assetRows.map((a) => ({
			id: a.id,
			kind: a.kind,
			name: a.name,
			filename: a.filename,
			mime: a.mime,
			size: a.size,
		})),
		assetBaseUrl: ctx.assetBaseUrl,
		excludeComponentName: ctx.target.excludeComponentName ?? ctx.target.name ?? null,
	};
}
