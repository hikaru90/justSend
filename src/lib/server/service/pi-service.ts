/**
 * Pi.dev SDK connection layer for Owlery.
 *
 * Embeds `@earendil-works/pi-coding-agent` via createAgentSession.
 * Auth reuses OPENROUTER_API_KEY.
 *
 * HTML edits: write the current HTML into a work directory, stage the team's
 * design library (design.md, components, assets) so Pi can read them itself,
 * let Pi change the target file with read/edit/write/ls, then read it back —
 * never treat Pi's chat text as the HTML.
 *
 * Docs: https://pi.dev — SDK: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import { cuid } from '$lib/utils';
import type { ComponentSlot, TEditorConfiguration } from '$lib/email-builder/types';
import { BLOCK_FACTORIES, EMPTY_DOCUMENT } from '$lib/email-builder/types';
import { validateComponentTree } from '$lib/email-builder/validate-component-tree';
import type { DesignAssetKind, TemplateComponentKind } from '../db/schema';
import { EMAIL_FORMATTING_RULES } from '../email-formatting-rules';
import { env } from '../env';
import {
	buildDesignWorkspaceContext,
	buildDesignWorkspaceUserPrompt,
	formatDesignAssetsForPrompt,
	inferDesignWorkspaceMode,
	toPiDesignContext,
	type DesignAssetPromptRef,
	type DesignWorkspaceMode,
} from './design-workspace-context';
import { openRouterChat, openRouterModel } from './openrouter';
import { installOpenRouterFetchThrottle } from './openrouter-rate-limit';
import { assetDiskPath, type DesignAsset } from './design-system-service';

export type { DesignAssetPromptRef, DesignWorkspaceMode };
export { formatDesignAssetsForPrompt };

export type PiSessionHandle = {
	id: string;
	session: AgentSession;
	createdAt: string;
	/** Present for multi-turn HTML edit sessions kept alive between prompts. */
	workDir?: string;
	filename?: string;
};

export type SpawnPiSessionOptions = {
	/** Working directory for the session. Default: process.cwd() */
	cwd?: string;
	/** Override model id (OpenRouter). Default: PI_MODEL ?? OPENROUTER_MODEL */
	modelId?: string;
	/**
	 * `connection` — tool-free ping/smoke session.
	 * `html-edit` — coding agent with read/edit/write/ls over a work directory (single file).
	 * `email-tree-edit` — coding agent over an `email/` multi-file Svelte tree.
	 */
	purpose?: 'connection' | 'html-edit' | 'email-tree-edit';
};

const HTML_EDIT_SYSTEM_PROMPT = [
	'You are a coding agent.',
	'Your job is to edit the email/component HTML file in the current working directory using your tools (read, edit, write, ls).',
	'Apply the user instruction to that file.',
	'Prefer editing the target file first — it often already reflects the brand from generation.',
	'Change ONLY what the instruction asks for. Do not rewrite unrelated markup, copy, structure, or styles.',
	'When the instruction needs brand tokens, patterns, or images, open design.md, components/, or assets/README.md yourself.',
	'For images/logos in HTML, use the embed URLs listed in assets/README.md (not local file paths).',
	'For light/dark logo or image variants, use the matching [logo/light] or [logo/dark] embed URL from assets/README.md.',
	'Preserve email-safe markup (tables with tbody around tr, inline CSS, Svelte props/snippets) unless asked to change them.',
	'Follow the Email formatting rules in AGENTS.md (620px column, #fefefe, spacers, CTA/footer patterns) unless the user asks otherwise.',
	'Always wrap <tr> inside <tbody>/<thead>/<tfoot> — never put <tr> directly under <table>.',
	'Do not create unrelated files. Do not leave the work directory.',
].join(' ');

const EMAIL_TREE_EDIT_SYSTEM_PROMPT = [
	'You are a coding agent.',
	'Your job is to edit the Svelte email component tree under email/ using your tools (read, edit, write, ls).',
	'Apply the user instruction across one or more files in email/ as needed.',
	'Root.svelte composes the email; section components are sibling .svelte files imported by Root.',
	'You may create new section .svelte files and update Root imports; you may remove unused section files.',
	'Change ONLY what the instruction asks for. Do not rewrite unrelated markup, copy, structure, or styles.',
	'When the instruction needs brand tokens, patterns, or images, open design.md, components/, or assets/README.md yourself.',
	'For images/logos in HTML, use the embed URLs listed in assets/README.md (not local file paths).',
	'For light/dark logo or image variants, use the matching [logo/light] or [logo/dark] embed URL from assets/README.md.',
	'Preserve email-safe markup (tables with tbody around tr, inline CSS, Svelte props/snippets) unless asked to change them.',
	'Follow the Email formatting rules in AGENTS.md (620px column, #fefefe, spacers, CTA/footer patterns) unless the user asks otherwise.',
	'Always wrap <tr> inside <tbody>/<thead>/<tfoot> — never put <tr> directly under <table>.',
	'Keep <script> limited to relative .svelte imports and $props() only — a single top-level <script> block (never two).',
	'Do not modify design.md, components/, or assets/. Do not leave the work directory.',
].join(' ');

/** A template component read back from a Pi email/ work tree. */
export type PiTemplateTreeComponent = {
	name: string;
	kind: TemplateComponentKind;
	source: string;
	order: number;
};

export type PiDesignAssetRef = {
	id: string;
	kind: DesignAssetKind;
	name: string;
	filename: string;
	mime: string;
	size: number;
};

export type PiDesignContext = {
	designMd?: string | null;
	components?: Array<{ name: string; description?: string | null; html: string }>;
	assets?: PiDesignAssetRef[];
	/** Base URL for /api/design-asset/{id} embed links. */
	assetBaseUrl?: string;
	/** Exclude a design-library component with this name (the one being edited). */
	excludeComponentName?: string | null;
};

/** Safe filename stem for a design component in the Pi work directory. */
export function slugifyPiComponentFilename(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'component';
}

export function safePiAssetFilename(filename: string): string {
	return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Relative path for a design asset inside the Pi work directory. */
export function piAssetRelativePath(
	asset: Pick<PiDesignAssetRef, 'id' | 'kind' | 'filename'>,
): string {
	return `assets/${asset.kind}/${asset.id}-${safePiAssetFilename(asset.filename)}`;
}

/**
 * Build text design-system files for the Pi work directory
 * (design.md, components/, assets/README.md). Binary assets are copied separately.
 */
export function buildPiDesignWorkspaceFiles(design?: PiDesignContext): Array<{
	relativePath: string;
	content: string;
}> {
	const files: Array<{ relativePath: string; content: string }> = [];
	const designMd = design?.designMd?.trim() ?? '';
	const excludeName = design?.excludeComponentName?.trim() ?? '';
	const components =
		design?.components?.filter((c) => c.html?.trim() && (!excludeName || c.name !== excludeName)) ??
		[];
	const assets = design?.assets ?? [];
	const assetBaseUrl = (design?.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');

	if (designMd) {
		files.push({
			relativePath: 'design.md',
			content: designMd.endsWith('\n') ? designMd : `${designMd}\n`,
		});
	}

	if (components.length > 0) {
		const used = new Set<string>();
		const indexLines = ['# Design components', '', 'Reference HTML patterns for this brand.', ''];
		for (const c of components) {
			let stem = slugifyPiComponentFilename(c.name);
			let filename = `${stem}.html`;
			let n = 2;
			while (used.has(filename)) {
				filename = `${stem}-${n}.html`;
				n += 1;
			}
			used.add(filename);
			const relativePath = `components/${filename}`;
			const header = [
				c.description?.trim()
					? `<!-- ${c.name}: ${c.description.trim()} -->`
					: `<!-- ${c.name} -->`,
				'',
			].join('\n');
			files.push({
				relativePath,
				content: `${header}${c.html.trim()}\n`,
			});
			indexLines.push(
				`- \`${relativePath}\` — ${c.name}${c.description?.trim() ? `: ${c.description.trim()}` : ''}`,
			);
		}
		indexLines.push('');
		files.push({ relativePath: 'components/README.md', content: indexLines.join('\n') });
	}

	if (assets.length > 0) {
		const indexLines = [
			'# Design assets',
			'',
			'Uploaded logos, images, and fonts for this brand.',
			'Use the **embed URL** in HTML `src` / CSS — not the local file path.',
			'',
			formatDesignAssetsForPrompt(assets, assetBaseUrl),
			'',
			'| kind | name | mime | size | local file | embed URL |',
			'| --- | --- | --- | --- | --- | --- |',
		];
		for (const a of assets) {
			const relativePath = piAssetRelativePath(a);
			const url = `${assetBaseUrl}/api/design-asset/${a.id}`;
			indexLines.push(
				`| ${a.kind} | ${a.name} | ${a.mime} | ${a.size} | \`${relativePath}\` | ${url} |`,
			);
		}
		indexLines.push('');
		files.push({ relativePath: 'assets/README.md', content: indexLines.join('\n') });
	}

	return files;
}

/** Copy design asset binaries from Owlery disk storage into the Pi work directory. */
export async function copyPiDesignAssetsToWorkDir(
	workDir: string,
	teamId: number,
	assets: DesignAsset[],
): Promise<void> {
	for (const asset of assets) {
		const relative = piAssetRelativePath(asset);
		const dest = join(workDir, relative);
		const src = assetDiskPath(teamId, asset.kind, asset.id, asset.filename);
		await mkdir(dirname(dest), { recursive: true });
		try {
			await copyFile(src, dest);
		} catch {
			// Missing on-disk file — skip; README still lists the embed URL.
		}
	}
}

export function buildPiAgentsMd(opts: {
	filename: string;
	metaLines: string[];
	designFiles: Array<{ relativePath: string }>;
}): string {
	const hasDesignMd = opts.designFiles.some((f) => f.relativePath === 'design.md');
	const hasComponents = opts.designFiles.some((f) => f.relativePath.startsWith('components/'));
	const hasAssets = opts.designFiles.some((f) => f.relativePath.startsWith('assets/'));
	const designSection: string[] = [];
	if (hasDesignMd || hasComponents || hasAssets) {
		designSection.push('## Design library (read on demand)', '');
		designSection.push(
			'- Edit the target file first; open these only when the instruction needs them.',
		);
		if (hasDesignMd) {
			designSection.push('- `design.md` — brand tokens, typography, colors.');
		}
		if (hasComponents) {
			designSection.push(
				'- `components/` — reusable HTML patterns (`components/README.md` index).',
			);
		}
		if (hasAssets) {
			designSection.push(
				'- `assets/README.md` — uploaded logos/images/fonts with embed URLs for HTML.',
			);
		}
		designSection.push('');
	}

	return [
		'# Owlery HTML edit workspace',
		'',
		`Edit \`${opts.filename}\` in this directory using your tools.`,
		'That file is the only source of truth for the result.',
		'',
		...(opts.metaLines.length ? ['## Meta', ...opts.metaLines, ''] : []),
		...designSection,
		'## Rules',
		'- Follow the Mode in Meta (create / edit / validate).',
		'- create: build from the instruction using the design library.',
		'- edit: change ONLY what the instruction asks for — do not rewrite unrelated markup.',
		'- validate: fix only concrete problems; leave good markup unchanged.',
		'- Before inventing colors, logos, or layout patterns, read design.md, components/, and assets/README.md.',
		'- Keep email-safe HTML (tables + inline CSS) unless asked otherwise.',
		'- Always wrap `<tr>` in `<tbody>`/`<thead>`/`<tfoot>` — never put `<tr>` directly under `<table>`.',
		'- Preserve `{{placeholders}}` unless asked to change them.',
		'- Do not modify files outside this directory.',
		'- Do not overwrite design.md, components/, or assets/; they are read-only context.',
		'- In HTML, reference assets via their embed URLs from assets/README.md.',
		'',
		EMAIL_FORMATTING_RULES.trim(),
	].join('\n');
}

/**
 * AGENTS.md for a whole-email multi-file Svelte tree under `email/`.
 */
export function buildPiEmailTreeAgentsMd(opts: {
	fileNames: string[];
	metaLines: string[];
	designFiles: Array<{ relativePath: string }>;
}): string {
	const hasDesignMd = opts.designFiles.some((f) => f.relativePath === 'design.md');
	const hasComponents = opts.designFiles.some((f) => f.relativePath.startsWith('components/'));
	const hasAssets = opts.designFiles.some((f) => f.relativePath.startsWith('assets/'));
	const designSection: string[] = [];
	if (hasDesignMd || hasComponents || hasAssets) {
		designSection.push('## Design library (read on demand)', '');
		designSection.push(
			'- Prefer editing `email/` first; open these only when the instruction needs them.',
		);
		if (hasDesignMd) {
			designSection.push('- `design.md` — brand tokens, typography, colors.');
		}
		if (hasComponents) {
			designSection.push(
				'- `components/` — reusable HTML patterns (`components/README.md` index).',
			);
		}
		if (hasAssets) {
			designSection.push(
				'- `assets/README.md` — uploaded logos/images/fonts with embed URLs for HTML.',
			);
		}
		designSection.push('');
	}

	const listed =
		opts.fileNames.length > 0
			? opts.fileNames.map((f) => `- \`email/${f}\``)
			: ['- (empty — create Root.svelte and section components)'];

	return [
		'# Owlery email tree edit workspace',
		'',
		'The email is a Svelte 5 component tree under `email/`.',
		'`email/Root.svelte` composes the message; other `email/*.svelte` files are sections.',
		'You may edit multiple files, add new section `.svelte` files, and update Root imports.',
		'You may delete unused section files. Keep exactly one Root.',
		'',
		'## Email files',
		...listed,
		'',
		...(opts.metaLines.length ? ['## Meta', ...opts.metaLines, ''] : []),
		...designSection,
		'## Rules',
		'- Keep email-safe HTML (tables + inline CSS) unless asked otherwise.',
		'- Always wrap `<tr>` in `<tbody>`/`<thead>`/`<tfoot>` — never put `<tr>` directly under `<table>`.',
		'- Bind element values via `$props()` — do not hardcode required-element values.',
		'- `<script>` may only contain relative `.svelte` imports and `$props()` — exactly one top-level `<script>` block.',
		'- Component file names must be PascalCase identifiers (e.g. `Header.svelte`, `Hero.svelte`).',
		'- Do not modify files outside this directory.',
		'- Do not overwrite design.md, components/, or assets/; they are read-only context.',
		'- In HTML, reference assets via their embed URLs from assets/README.md.',
		'',
		EMAIL_FORMATTING_RULES.trim(),
	].join('\n');
}

/** Safe PascalCase-ish filename stem for email/*.svelte staging. */
export function safePiEmailComponentFilename(name: string): string {
	const trimmed = name.trim().replace(/\.svelte$/i, '');
	const cleaned = trimmed.replace(/[^A-Za-z0-9_]/g, '');
	if (/^[A-Za-z][A-Za-z0-9_]*$/.test(cleaned)) return cleaned;
	const fallback = cleaned.replace(/^[^A-Za-z]+/, '');
	return fallback || 'Component';
}

/**
 * Read `email/*.svelte` from a Pi work directory into template component rows.
 * Root (case-insensitive) → kind root; others → component. Empty files skipped.
 */
export async function readPiEmailTree(emailDir: string): Promise<PiTemplateTreeComponent[]> {
	let entries: string[];
	try {
		entries = await readdir(emailDir);
	} catch (err) {
		const code =
			err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : '';
		if (code === 'ENOENT') {
			throw new Error('Pi finished but email/ directory is missing. The tree was not applied.');
		}
		throw err;
	}

	const svelteFiles = entries
		.filter((e) => e.toLowerCase().endsWith('.svelte'))
		.map((e) => basename(e))
		.sort((a, b) => {
			const aRoot = a.replace(/\.svelte$/i, '').toLowerCase() === 'root';
			const bRoot = b.replace(/\.svelte$/i, '').toLowerCase() === 'root';
			if (aRoot && !bRoot) return -1;
			if (!aRoot && bRoot) return 1;
			return a.localeCompare(b);
		});

	const components: PiTemplateTreeComponent[] = [];
	for (const file of svelteFiles) {
		const stem = file.replace(/\.svelte$/i, '');
		const name = safePiEmailComponentFilename(stem);
		if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(stem) && name === 'Component') {
			continue;
		}
		const source = await readFile(join(emailDir, file), 'utf8');
		if (!source.trim() || !looksLikeHtml(source)) continue;
		const kind: TemplateComponentKind = name.toLowerCase() === 'root' ? 'root' : 'component';
		components.push({
			name: kind === 'root' ? 'Root' : name,
			kind,
			source,
			order: components.length,
		});
	}

	return components;
}

type PiRegistryEntry = PiSessionHandle;

const registry = new Map<string, PiRegistryEntry>();

let runtimePromise: Promise<ModelRuntime> | null = null;

/** Initial + retries: first attempt, then up to 3 more on 429 / rate-limit. */
const PI_RATE_LIMIT_RETRIES = 3;
/** After a failed prompt turn, wait a few seconds before retrying. */
const PI_RATE_LIMIT_BASE_DELAY_MS = 5_000;
/** Minimum gap between consecutive Pi prompts (serialize). HTTP is also ≤1/s via openrouter-rate-limit. */
const PI_PROMPT_MIN_GAP_MS = 1_000;

let piPromptChain: Promise<void> = Promise.resolve();
let lastPiPromptAt = 0;

export function isPiRateLimitError(message: string): boolean {
	return /\b429\b|rate[- ]?limit(?:ed)?|temporarily rate-limited|insufficient_quota|upstream_provider_shared_pool/i.test(
		message,
	);
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			const err = new Error('Edit cancelled');
			err.name = 'AbortError';
			reject(err);
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			const err = new Error('Edit cancelled');
			err.name = 'AbortError';
			reject(err);
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

/**
 * Run Pi prompts one-at-a-time with a short gap so we don't stampede OpenRouter.
 */
async function withPiPromptSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	const prev = piPromptChain;
	let release!: () => void;
	piPromptChain = new Promise<void>((r) => {
		release = r;
	});
	await prev;
	try {
		if (signal?.aborted) {
			const err = new Error('Edit cancelled');
			err.name = 'AbortError';
			throw err;
		}
		const gap = PI_PROMPT_MIN_GAP_MS - (Date.now() - lastPiPromptAt);
		if (gap > 0) await sleepMs(gap, signal);
		return await fn();
	} finally {
		lastPiPromptAt = Date.now();
		release();
	}
}

type RunPiPromptOptions = {
	signal?: AbortSignal;
	onEvent?: (event: PiEditStreamEvent) => void;
};

/**
 * Prompt + waitForIdle, retrying up to {@link PI_RATE_LIMIT_RETRIES} times on 429 /
 * rate-limit errors. Waits a few seconds between retries; OpenRouter HTTP is also
 * capped at 1 request/second by {@link installOpenRouterFetchThrottle}.
 */
export async function runPiPromptWithRetries(
	session: AgentSession,
	prompt: string,
	opts: RunPiPromptOptions = {},
): Promise<void> {
	await withPiPromptSlot(async () => {
		const maxAttempts = PI_RATE_LIMIT_RETRIES + 1;
		let lastRateLimitError: string | null = null;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			if (opts.signal?.aborted) {
				const err = new Error('Edit cancelled');
				err.name = 'AbortError';
				throw err;
			}

			await session.prompt(prompt);
			await session.agent.waitForIdle();

			if (opts.signal?.aborted) {
				const err = new Error('Edit cancelled');
				err.name = 'AbortError';
				throw err;
			}

			const agentError = session.agent.state.errorMessage;
			if (!agentError) return;

			const retriesLeft = maxAttempts - attempt;
			if (!isPiRateLimitError(agentError) || retriesLeft <= 0) {
				if (isPiRateLimitError(agentError)) {
					const model = getPiModelId();
					throw new Error(
						`Pi agent error: rate limited after ${PI_RATE_LIMIT_RETRIES} retries (${model}). ` +
							`Wait a minute and try again, set PI_MODEL to another OpenRouter model, ` +
							`or add your own provider key at openrouter.ai/settings/integrations. ` +
							`Upstream: ${agentError.slice(0, 280)}`,
					);
				}
				throw new Error(`Pi agent error: ${agentError}`);
			}

			lastRateLimitError = agentError;
			const delayMs = PI_RATE_LIMIT_BASE_DELAY_MS;
			opts.onEvent?.({
				type: 'step',
				message: `Rate limited by provider; waiting ${Math.round(delayMs / 1000)}s then retrying (${attempt}/${PI_RATE_LIMIT_RETRIES})…`,
			});
			await sleepMs(delayMs, opts.signal);
		}
		if (lastRateLimitError) {
			throw new Error(`Pi agent error: ${lastRateLimitError}`);
		}
	}, opts.signal);
}

export function resolvePiConfigured(input: {
	piEnabled: boolean | undefined;
	openRouterApiKey: string | undefined;
}): boolean {
	if (input.piEnabled === false) return false;
	return Boolean(input.openRouterApiKey?.trim());
}

export function isPiConfigured(): boolean {
	return resolvePiConfigured({
		piEnabled: env.PI_ENABLED,
		openRouterApiKey: env.OPENROUTER_API_KEY,
	});
}

export function getPiModelId(override?: string): string {
	return (override?.trim() || env.PI_MODEL?.trim() || env.OPENROUTER_MODEL).trim();
}

export function resolvePiAgentDir(): string {
	return resolve(process.cwd(), env.PI_AGENT_DIR);
}

export function resolvePiWorkRoot(): string {
	return resolve(process.cwd(), env.PI_AGENT_DIR, '..', 'work');
}

export async function createPiRuntime(): Promise<ModelRuntime> {
	if (!isPiConfigured()) {
		throw new Error(
			'Pi is not configured (set OPENROUTER_API_KEY, or PI_ENABLED=false to disable)',
		);
	}

	installOpenRouterFetchThrottle();

	const agentDir = resolvePiAgentDir();
	await mkdir(agentDir, { recursive: true });

	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, 'auth.json'),
		modelsPath: join(agentDir, 'models.json'),
	});

	await modelRuntime.setRuntimeApiKey('openrouter', env.OPENROUTER_API_KEY!);
	return modelRuntime;
}

async function getSharedRuntime(): Promise<ModelRuntime> {
	if (!runtimePromise) {
		runtimePromise = createPiRuntime().catch((err) => {
			runtimePromise = null;
			throw err;
		});
	}
	return runtimePromise;
}

/** Reset cached runtime (tests / after auth changes). */
export function resetPiRuntimeCache(): void {
	runtimePromise = null;
}

export async function spawnPiSession(opts: SpawnPiSessionOptions = {}): Promise<PiSessionHandle> {
	const modelRuntime = await getSharedRuntime();
	const modelId = getPiModelId(opts.modelId);
	const model = modelRuntime.getModel('openrouter', modelId);
	if (!model) {
		throw new Error(
			`Pi model not found for openrouter/${modelId}. Check PI_MODEL / OPENROUTER_MODEL.`,
		);
	}

	const cwd = opts.cwd ?? process.cwd();
	const agentDir = resolvePiAgentDir();
	const purpose = opts.purpose ?? 'connection';
	const settingsManager = SettingsManager.inMemory();
	const isCodingEdit = purpose === 'html-edit' || purpose === 'email-tree-edit';
	const systemPrompt =
		purpose === 'email-tree-edit'
			? EMAIL_TREE_EDIT_SYSTEM_PROMPT
			: purpose === 'html-edit'
				? HTML_EDIT_SYSTEM_PROMPT
				: 'You are a minimal connectivity probe. Reply briefly.';

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		// coding edits: allow AGENTS.md in the work dir; connection: no project context
		noContextFiles: !isCodingEdit,
		...(isCodingEdit
			? { systemPrompt }
			: {
					agentsFilesOverride: () => ({ agentsFiles: [] }),
					systemPrompt,
				}),
	});
	await resourceLoader.reload();

	let session: AgentSession | undefined;
	try {
		const result = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime,
			model,
			// Coding edits: enable thinking so the UI can stream it. Connection probes stay quiet.
			thinkingLevel: isCodingEdit ? 'low' : 'off',
			...(isCodingEdit ? { tools: ['read', 'edit', 'write', 'ls'] } : { noTools: 'all' as const }),
			resourceLoader,
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager,
		});
		session = result.session;

		const handle: PiSessionHandle = {
			id: cuid(),
			session,
			createdAt: new Date().toISOString(),
		};
		registry.set(handle.id, handle);
		return handle;
	} catch (err) {
		session?.dispose();
		throw err;
	}
}

export function getPiSession(id: string): PiSessionHandle | undefined {
	return registry.get(id);
}

export function listPiSessions(): PiSessionHandle[] {
	return [...registry.values()];
}

export function disposePiSession(id: string): boolean {
	const handle = registry.get(id);
	if (!handle) return false;
	registry.delete(id);
	try {
		handle.session.dispose();
	} catch {
		// Session may already be disposed.
	}
	if (handle.workDir) {
		void rm(handle.workDir, { recursive: true, force: true }).catch(() => undefined);
	}
	return true;
}

export function disposeAllPiSessions(): number {
	const ids = [...registry.keys()];
	for (const id of ids) {
		disposePiSession(id);
	}
	return ids.length;
}

function collectTextDelta(event: AgentSessionEvent, sink: { text: string }) {
	if (event.type !== 'message_update') return;
	const assistantEvent = (event as { assistantMessageEvent?: { type?: string; delta?: string } })
		.assistantMessageEvent;
	if (assistantEvent?.type === 'text_delta' && typeof assistantEvent.delta === 'string') {
		sink.text += assistantEvent.delta;
	}
}

/** Public progress events forwarded to the templates/[id] Pi edit SSE client. */
export type PiEditStreamEvent =
	| { type: 'step'; message: string }
	| { type: 'system'; content: string }
	| { type: 'context'; content: string }
	| { type: 'thinking'; delta: string }
	| { type: 'text'; delta: string }
	| { type: 'tool_start'; toolName: string; detail?: string }
	| { type: 'tool_end'; toolName: string; isError?: boolean; detail?: string }
	| {
			type: 'done';
			html?: string;
			message?: string;
			/** Multi-turn HTML edit session id (when keepSession was used). */
			sessionId?: string;
			/** Present after whole-email tree edits. */
			components?: PiTemplateTreeComponent[];
			/** Present after component-tree JSON edits. */
			document?: import('$lib/email-builder/types').TEditorConfiguration;
			slots?: import('$lib/email-builder/types').ComponentSlot[];
			mode?: DesignWorkspaceMode;
			approach?: import('$lib/email-builder/edit-approach').EditApproach;
	  }
	| { type: 'error'; message: string }
	| { type: 'cancelled'; message: string };

function summarizeForStream(value: unknown, max = 160): string | undefined {
	if (value == null) return undefined;
	try {
		let text: string;
		if (typeof value === 'string') {
			text = value;
		} else if (typeof value === 'object' && value !== null && 'path' in value) {
			const path = (value as { path?: unknown }).path;
			text = typeof path === 'string' ? path : JSON.stringify(value);
		} else {
			text = JSON.stringify(value);
		}
		if (!text) return undefined;
		return text.length > max ? `${text.slice(0, max)}…` : text;
	} catch {
		return undefined;
	}
}

/**
 * Map a Pi SDK session event to a client-facing progress event (or null to skip).
 * Exported for unit tests.
 */
export function mapAgentSessionEventToPiEdit(event: AgentSessionEvent): PiEditStreamEvent | null {
	switch (event.type) {
		case 'agent_start':
			return { type: 'step', message: 'Pi started' };
		case 'turn_start': {
			const turnIndex =
				typeof (event as { turnIndex?: unknown }).turnIndex === 'number'
					? (event as unknown as { turnIndex: number }).turnIndex
					: undefined;
			return {
				type: 'step',
				message: turnIndex != null ? `Turn ${turnIndex + 1}` : 'Working…',
			};
		}
		case 'message_update': {
			const assistantEvent = (
				event as {
					assistantMessageEvent?: { type?: string; delta?: string };
				}
			).assistantMessageEvent;
			if (!assistantEvent?.type) return null;
			if (
				assistantEvent.type === 'thinking_delta' &&
				typeof assistantEvent.delta === 'string' &&
				assistantEvent.delta
			) {
				return { type: 'thinking', delta: assistantEvent.delta };
			}
			if (
				assistantEvent.type === 'text_delta' &&
				typeof assistantEvent.delta === 'string' &&
				assistantEvent.delta
			) {
				return { type: 'text', delta: assistantEvent.delta };
			}
			return null;
		}
		case 'tool_execution_start': {
			const e = event as {
				toolName?: string;
				args?: unknown;
			};
			const toolName = e.toolName?.trim() || 'tool';
			return {
				type: 'tool_start',
				toolName,
				detail: summarizeForStream(e.args),
			};
		}
		case 'tool_execution_end': {
			const e = event as {
				toolName?: string;
				result?: unknown;
				isError?: boolean;
			};
			const toolName = e.toolName?.trim() || 'tool';
			return {
				type: 'tool_end',
				toolName,
				isError: Boolean(e.isError),
				detail: summarizeForStream(e.result),
			};
		}
		default:
			return null;
	}
}

/**
 * Smoke connectivity: prompt the session and return collected assistant text.
 * Expects a tool-free session.
 */
export async function pingPiSession(
	sessionOrHandle: AgentSession | PiSessionHandle,
): Promise<string> {
	return promptPiSession(sessionOrHandle, 'Reply with exactly: pong');
}

/**
 * Send a prompt and wait until the agent is idle (tools included).
 * Returns collected assistant text for debugging — not used as HTML source.
 */
export async function promptPiSession(
	sessionOrHandle: AgentSession | PiSessionHandle,
	prompt: string,
): Promise<string> {
	const session = 'session' in sessionOrHandle ? sessionOrHandle.session : sessionOrHandle;
	const sink = { text: '' };
	const unsubscribe = session.subscribe((event: AgentSessionEvent) =>
		collectTextDelta(event, sink),
	);

	try {
		await runPiPromptWithRetries(session, prompt);
		return sink.text.trim();
	} finally {
		unsubscribe();
	}
}

/** True if content looks like markup we can load into the editor. */
export function looksLikeHtml(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	return /<\/?[a-zA-Z][\w:-]*\b/.test(t) || /\$props\s*\(/.test(t) || /\{#snippet\b/.test(t);
}

/**
 * True when `after` is effectively identical to `before` (whitespace-only
 * differences). Used to detect a Pi run that did not actually edit the file —
 * so we can fail honestly instead of reporting a false "applied".
 */
export function htmlEffectivelyUnchanged(before: string, after: string): boolean {
	const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
	return norm(before) === norm(after);
}

export type EditHtmlWithPiInput = {
	html: string;
	instruction: string;
	/** Team whose design library is staged into the work directory. */
	teamId: number;
	/** Origin for /api/design-asset/{id} URLs (default: HOST_URL). */
	assetBaseUrl?: string;
	/** Override work-file name (default email.html / component.html). */
	filename?: string;
	/** create | edit | validate — inferred from empty html when omitted */
	mode?: DesignWorkspaceMode | string | null;
	context?: {
		kind?: 'component' | 'template';
		name?: string;
		description?: string | null;
		subject?: string;
	};
	/**
	 * Continue an existing multi-turn edit session.
	 * When set, skips workspace setup and reuses the Pi agent conversation.
	 */
	sessionId?: string;
	/**
	 * Keep the session and work directory alive after this prompt (for follow-up edits).
	 * Default false — one-shot edits dispose when finished.
	 */
	keepSession?: boolean;
	/** Abort signal (SSE client disconnect / Stop). */
	signal?: AbortSignal;
	/** Live progress for SSE clients. */
	onEvent?: (event: PiEditStreamEvent) => void;
};

export type EditHtmlWithPiResult = {
	html: string;
	sessionId: string;
};

/**
 * Let Pi edit HTML as a coding agent:
 * 1. Write current HTML into an isolated work directory
 * 2. Load the team's design library (design.md, components, assets) into that directory
 * 3. Spawn Pi with read/edit/write/ls so it can fetch context itself
 * 4. Instruct Pi to change the target file (optionally streaming progress)
 * 5. Read the file back and return it for the UI/DB
 *
 * Pass `sessionId` + `keepSession: true` to continue the same agent conversation
 * across multiple edits in one UI session.
 */
export async function editHtmlWithPi(input: EditHtmlWithPiInput): Promise<EditHtmlWithPiResult> {
	const instruction = input.instruction.trim();
	if (!instruction) {
		throw new Error('Instruction is required');
	}

	const emit = (event: PiEditStreamEvent) => {
		try {
			input.onEvent?.(event);
		} catch {
			// Client callback errors must not break the edit.
		}
	};

	if (input.signal?.aborted) {
		const err = new Error('Edit cancelled');
		err.name = 'AbortError';
		throw err;
	}

	const keepSession = Boolean(input.keepSession);
	let handle: PiSessionHandle;
	let workDir: string;
	let filename: string;
	let filePath: string;
	let continuing = false;

	if (input.sessionId) {
		const existing = getPiSession(input.sessionId);
		if (!existing?.workDir || !existing.filename) {
			throw new Error('Edit session expired. Start a new edit.');
		}
		handle = existing;
		workDir = existing.workDir;
		filename = existing.filename;
		filePath = join(workDir, filename);
		continuing = true;
		await writeFile(filePath, input.html.trim() ? input.html : '<!-- empty -->\n', 'utf8');
		emit({ type: 'step', message: 'Continuing Pi…' });
	} else {
		const workId = cuid();
		workDir = join(resolvePiWorkRoot(), workId);
		filename =
			input.filename ?? (input.context?.kind === 'component' ? 'component.html' : 'email.html');
		filePath = join(workDir, filename);
		const assetBaseUrl = (input.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');

		await mkdir(workDir, { recursive: true });
		await writeFile(filePath, input.html.trim() ? input.html : '<!-- empty -->\n', 'utf8');

		const mode = inferDesignWorkspaceMode({
			mode: input.mode,
			instruction,
			document: input.html.trim()
				? {
						root: {
							type: 'EmailLayout',
							data: { childrenIds: ['_existing'] },
						},
					}
				: EMPTY_DOCUMENT,
		});

		const workspace = buildDesignWorkspaceContext({
			teamId: input.teamId,
			mode,
			assetBaseUrl,
			target: {
				kind: 'component-tree',
				name: input.context?.name,
				description: input.context?.description,
				document: EMPTY_DOCUMENT,
				slots: [],
				excludeComponentName: input.context?.name,
			},
		});
		const design: PiDesignContext = toPiDesignContext(workspace);

		const designFiles = buildPiDesignWorkspaceFiles(design);
		for (const file of designFiles) {
			const absolute = join(workDir, file.relativePath);
			await mkdir(dirname(absolute), { recursive: true });
			await writeFile(absolute, file.content, 'utf8');
		}
		await copyPiDesignAssetsToWorkDir(workDir, input.teamId, workspace.assetRows);

		const metaLines = [
			`- mode: ${mode}`,
			input.context?.kind ? `- kind: ${input.context.kind}` : null,
			input.context?.name ? `- name: ${input.context.name}` : null,
			input.context?.description ? `- description: ${input.context.description}` : null,
			input.context?.subject ? `- subject: ${input.context.subject}` : null,
		].filter((line): line is string => Boolean(line));

		await writeFile(
			join(workDir, 'AGENTS.md'),
			buildPiAgentsMd({ filename, metaLines, designFiles }),
			'utf8',
		);

	emit({
		type: 'step',
		message: `Context: design.md, ${workspace.assets.length} assets, ${workspace.libraryComponents.length} peer components (${mode}).`,
	});
	emit({ type: 'system', content: HTML_EDIT_SYSTEM_PROMPT });
	const agentsMd = buildPiAgentsMd({ filename, metaLines, designFiles });
	emit({
		type: 'context',
		content: [
			`Work directory: ${designFiles.map((f) => f.relativePath).join(', ') || '(empty)'}`,
			'',
			agentsMd,
		].join('\n'),
	});
	emit({ type: 'step', message: 'Starting Pi…' });

	handle = await spawnPiSession({ purpose: 'html-edit', cwd: workDir });
		const entry = registry.get(handle.id);
		if (entry) {
			entry.workDir = workDir;
			entry.filename = filename;
		}
	}

	const onAbort = () => {
		void handle.session.abort().catch(() => undefined);
	};
	input.signal?.addEventListener('abort', onAbort);

	const unsubscribe = handle.session.subscribe((event: AgentSessionEvent) => {
		const mapped = mapAgentSessionEventToPiEdit(event);
		if (mapped) emit(mapped);
	});

	try {
		if (input.signal?.aborted) {
			const err = new Error('Edit cancelled');
			err.name = 'AbortError';
			throw err;
		}

		const prompt = continuing
			? [
					`Continue editing \`${filename}\` in the current working directory.`,
					`Absolute path: ${filePath}`,
					'',
					'## Instruction',
					instruction,
					'',
					'The file may have been updated since your last turn — re-read it if needed, then apply this change with your tools.',
					'When done, the updated HTML must be saved in that file.',
				].join('\n')
			: [
					`Open and edit \`${filename}\` in the current working directory.`,
					`Absolute path: ${filePath}`,
					'',
					'## Instruction',
					instruction,
					'',
					'Use your read/edit/write/ls tools to apply the change to that file.',
					'Design context (design.md, components/, assets/) is in this directory — open it yourself when needed.',
					'When done, the updated HTML must be saved in that file.',
				].join('\n');

		emit({ type: 'context', content: `## User prompt\n${prompt}` });
		await runPiPromptWithRetries(handle.session, prompt, {
			signal: input.signal,
			onEvent: emit,
		});

		const edited = await readFile(filePath, 'utf8');
		if (!looksLikeHtml(edited)) {
			throw new Error(
				`Pi finished but \`${filename}\` does not look like markup. The file was not applied.`,
			);
		}
		if (htmlEffectivelyUnchanged(input.html, edited)) {
			throw new Error(
				`Pi finished without editing \`${filename}\`. The model replied but did not use its edit tools to change the file — try a more specific instruction, or use a model that supports tool calling.`,
			);
		}
		return { html: edited, sessionId: handle.id };
	} finally {
		input.signal?.removeEventListener('abort', onAbort);
		unsubscribe();
		if (!keepSession) {
			disposePiSession(handle.id);
		}
	}
}

/**
 * Same as {@link editHtmlWithPi} but requires an `onEvent` callback for SSE streaming.
 */
export async function editHtmlWithPiStream(
	input: EditHtmlWithPiInput & { onEvent: (event: PiEditStreamEvent) => void },
): Promise<EditHtmlWithPiResult> {
	return editHtmlWithPi(input);
}

export type EditTemplateTreeWithPiInput = {
	components: Array<{
		name: string;
		kind: TemplateComponentKind;
		source: string;
		order?: number;
	}>;
	instruction: string;
	teamId: number;
	assetBaseUrl?: string;
	subject?: string;
	/** Abort signal (SSE client disconnect / Stop). */
	signal?: AbortSignal;
	/** Live progress for SSE clients. */
	onEvent?: (event: PiEditStreamEvent) => void;
};

/**
 * Let Pi edit a full Svelte email component tree:
 * 1. Stage all components under email/*.svelte in an isolated work directory
 * 2. Load the team's design library for on-demand context
 * 3. Spawn Pi with read/edit/write/ls so it can change any/all files and add sections
 * 4. Read email/ back and return the component list for DB sync
 */
export async function editTemplateTreeWithPi(
	input: EditTemplateTreeWithPiInput,
): Promise<PiTemplateTreeComponent[]> {
	const instruction = input.instruction.trim();
	if (!instruction) {
		throw new Error('Instruction is required');
	}
	if (input.components.length === 0) {
		throw new Error('No components to edit');
	}

	const emit = (event: PiEditStreamEvent) => {
		try {
			input.onEvent?.(event);
		} catch {
			// Client callback errors must not break the edit.
		}
	};

	if (input.signal?.aborted) {
		const err = new Error('Edit cancelled');
		err.name = 'AbortError';
		throw err;
	}

	const workId = cuid();
	const workDir = join(resolvePiWorkRoot(), workId);
	const emailDir = join(workDir, 'email');
	const assetBaseUrl = (input.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');

	await mkdir(emailDir, { recursive: true });

	const usedNames = new Set<string>();
	const stagedFiles: string[] = [];
	const sorted = [...input.components].sort(
		(a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
	);

	for (const component of sorted) {
		const baseName =
			component.kind === 'root' ? 'Root' : safePiEmailComponentFilename(component.name);
		let fileStem = baseName;
		let n = 2;
		while (usedNames.has(fileStem.toLowerCase())) {
			fileStem = `${baseName}${n}`;
			n += 1;
		}
		usedNames.add(fileStem.toLowerCase());
		const filename = `${fileStem}.svelte`;
		stagedFiles.push(filename);
		await writeFile(
			join(emailDir, filename),
			component.source.trim() ? component.source : '<!-- empty -->\n',
			'utf8',
		);
	}

	const workspace = buildDesignWorkspaceContext({
		teamId: input.teamId,
		mode: 'edit',
		assetBaseUrl,
		target: {
			kind: 'component-tree',
			document: EMPTY_DOCUMENT,
			slots: [],
		},
	});
	const design: PiDesignContext = toPiDesignContext(workspace);

	const designFiles = buildPiDesignWorkspaceFiles(design);
	for (const file of designFiles) {
		const absolute = join(workDir, file.relativePath);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, file.content, 'utf8');
	}
	await copyPiDesignAssetsToWorkDir(workDir, input.teamId, workspace.assetRows);

	const metaLines = [
		'- kind: email-tree',
		'- mode: edit',
		`- components: ${stagedFiles.length}`,
		input.subject ? `- subject: ${input.subject}` : null,
	].filter((line): line is string => Boolean(line));

	await writeFile(
		join(workDir, 'AGENTS.md'),
		buildPiEmailTreeAgentsMd({ fileNames: stagedFiles, metaLines, designFiles }),
		'utf8',
	);

	emit({
		type: 'step',
		message: `Context: design.md, ${workspace.assets.length} assets, ${workspace.libraryComponents.length} peer components.`,
	});
	emit({ type: 'system', content: EMAIL_TREE_EDIT_SYSTEM_PROMPT });
	const agentsMd = buildPiEmailTreeAgentsMd({ fileNames: stagedFiles, metaLines, designFiles });
	emit({
		type: 'context',
		content: [
			`Work directory: email/, ${designFiles.map((f) => f.relativePath).join(', ') || '(empty)'}`,
			'',
			agentsMd,
		].join('\n'),
	});
	emit({ type: 'step', message: 'Starting Pi…' });

	const handle = await spawnPiSession({ purpose: 'email-tree-edit', cwd: workDir });
	const onAbort = () => {
		void handle.session.abort().catch(() => undefined);
	};
	input.signal?.addEventListener('abort', onAbort);

	const unsubscribe = handle.session.subscribe((event: AgentSessionEvent) => {
		const mapped = mapAgentSessionEventToPiEdit(event);
		if (mapped) emit(mapped);
	});

	try {
		if (input.signal?.aborted) {
			const err = new Error('Edit cancelled');
			err.name = 'AbortError';
			throw err;
		}

		const treePrompt = [
				'Edit the Svelte email under `email/` in the current working directory.',
				`Email directory: ${emailDir}`,
				'',
				'## Instruction',
				instruction,
				'',
				'Use your read/edit/write/ls tools. You may change multiple files, add new section `.svelte` files, and update Root imports.',
				'Design context (design.md, components/, assets/) is in this directory — open it yourself when needed.',
				'When done, the updated tree must live under `email/` with exactly one Root.svelte.',
			].join('\n');

		emit({ type: 'context', content: `## User prompt\n${treePrompt}` });
		await runPiPromptWithRetries(handle.session, treePrompt, {
			signal: input.signal,
			onEvent: emit,
		});

		const tree = await readPiEmailTree(emailDir);
		const roots = tree.filter((c) => c.kind === 'root');
		if (roots.length !== 1) {
			throw new Error(
				`Pi finished but email/ must contain exactly one Root (found ${roots.length}). The tree was not applied.`,
			);
		}
		if (tree.length === 0) {
			throw new Error(
				'Pi finished but email/ has no valid .svelte components. The tree was not applied.',
			);
		}
		return tree;
	} finally {
		input.signal?.removeEventListener('abort', onAbort);
		unsubscribe();
		disposePiSession(handle.id);
		await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * Same as {@link editTemplateTreeWithPi} but requires an `onEvent` callback for SSE streaming.
 */
export async function editTemplateTreeWithPiStream(
	input: EditTemplateTreeWithPiInput & { onEvent: (event: PiEditStreamEvent) => void },
): Promise<PiTemplateTreeComponent[]> {
	return editTemplateTreeWithPi(input);
}

export type EditComponentTreeWithPiInput = {
	teamId: number;
	instruction: string;
	document: TEditorConfiguration;
	slots: ComponentSlot[];
	name?: string;
	description?: string | null;
	/** create | edit | validate — inferred when omitted */
	mode?: DesignWorkspaceMode | string | null;
	assetBaseUrl?: string;
	signal?: AbortSignal;
	onEvent?: (event: PiEditStreamEvent) => void;
};

export type EditComponentTreeWithPiResult = {
	document: TEditorConfiguration;
	slots: ComponentSlot[];
	mode: DesignWorkspaceMode;
};

const COMPONENT_TREE_SYSTEM = [
	'You create, edit, or validate email-builder JSON documents (design-system components or full template emails).',
	'Return ONLY valid JSON (no markdown fences) with this exact shape:',
	'{ "document": <TEditorConfiguration>, "slots": <ComponentSlot[]> }',
	'',
	'TEditorConfiguration is a map of blockId -> { type, data }.',
	'It MUST include a "root" block with type "EmailLayout" and data.childrenIds.',
	`Allowed block types: EmailLayout, ${BLOCK_FACTORIES.map((f) => f.type).join(', ')}.`,
	'',
	'Block data shapes:',
	'- EmailLayout data: { backdropColor, canvasColor, textColor, fontFamily, childrenIds: string[] }',
	'- Heading data: { props: { text, level? }, style?: { padding, color?, fontSize?, fontWeight? } }',
	'- Text data: { props: { text, markdown: true }, style?: { padding, color?, fontWeight? } } — text supports Markdown (**bold**, *italic*, links, lists)',
	'- Button data: { props: { text, url, buttonBackgroundColor?, buttonTextColor? }, style?: { padding } } — use brand primary from design.md for buttonBackgroundColor',
	'- Image data: { props: { url, alt, contentAlignment?, linkHref?, width? }, style?: { padding } }',
	'- Divider data: { props: { lineColor }, style?: { padding } }',
	'- Spacer data: { props: { height } }',
	'- Html data: { props: { contents }, style?: { padding } }',
	'- Container data: { props: { childrenIds }, style?: { padding, backgroundColor, borderColor, borderRadius } }',
	'- ColumnsContainer data: { props: { columnsCount, columnsGap, columns: [{ childrenIds }] }, style?: { padding } }',
	'',
	'When creating or restyling blocks, apply brand colors from design.md (primary CTA fill, text, muted divider).',
	'',
	'ComponentSlot: { name, blockId, prop, type: "text"|"url"|"asset"|"color", label? }',
	'prop is a path under block.data, e.g. "props.text", "props.url", "style.backgroundColor".',
	'Every slot.blockId must exist in document. Prefer marking copy/image fields as slots. For full template emails, slots may be empty.',
	'',
	'Follow the Mode rules in the user message (create / edit / validate).',
	'Use design.md, email formatting rules, assets, and peer library components from the user message as authoritative context.',
	'Never invent asset URLs — only use embed URLs listed under Assets.',
	'Follow email-safe layout: ~600px canvas, clear hierarchy, one primary CTA when relevant.',
].join('\n');

/**
 * Edit a design-system component block tree via OpenRouter JSON mode.
 * Context always comes from {@link buildDesignWorkspaceContext} (create/edit/validate).
 */
export async function editComponentTreeWithPi(
	input: EditComponentTreeWithPiInput,
): Promise<EditComponentTreeWithPiResult> {
	const emit = (event: PiEditStreamEvent) => input.onEvent?.(event);

	const mode = inferDesignWorkspaceMode({
		mode: input.mode,
		instruction: input.instruction,
		document: input.document,
	});

	emit({ type: 'step', message: `Preparing ${mode} context…` });

	const workspace = buildDesignWorkspaceContext({
		teamId: input.teamId,
		mode,
		assetBaseUrl: input.assetBaseUrl,
		target: {
			kind: 'component-tree',
			name: input.name,
			description: input.description,
			document: input.document,
			slots: input.slots,
			excludeComponentName: input.name,
		},
	});

	emit({
		type: 'step',
		message: `Context: design.md, ${workspace.assets.length} assets, ${workspace.libraryComponents.length} peer components.`,
	});
	emit({ type: 'system', content: COMPONENT_TREE_SYSTEM });

	const userPrompt = buildDesignWorkspaceUserPrompt(workspace, input.instruction);
	emit({ type: 'context', content: userPrompt });
	emit({ type: 'step', message: `Calling ${openRouterModel()} (JSON mode)…` });

	const raw = await openRouterChat(
		[
			{ role: 'system', content: COMPONENT_TREE_SYSTEM },
			{ role: 'user', content: userPrompt },
		],
		{
			signal: input.signal,
			stream: true,
			jsonObject: true,
			onDelta: (delta) => emit({ type: 'text', delta }),
		},
	);

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('Pi returned invalid JSON for the component tree');
	}

	const validated = validateComponentTree(parsed);
	if (!validated.ok) {
		throw new Error(`Invalid component tree: ${validated.error}`);
	}

	emit({ type: 'step', message: 'Validated document and slots.' });
	return { document: validated.document, slots: validated.slots, mode };
}

export async function editComponentTreeWithPiStream(
	input: EditComponentTreeWithPiInput & { onEvent: (event: PiEditStreamEvent) => void },
): Promise<EditComponentTreeWithPiResult> {
	return editComponentTreeWithPi(input);
}
