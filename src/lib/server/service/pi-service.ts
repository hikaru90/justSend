/**
 * Pi.dev SDK connection layer for Owlery.
 *
 * Embeds `@earendil-works/pi-coding-agent` via createAgentSession.
 * Auth reuses OPENROUTER_API_KEY.
 *
 * HTML edits: write the current HTML into a work directory, let Pi (coding agent
 * with read/edit/write tools) change that file, then read the file back and load
 * it into the template/component — never treat Pi's chat text as the HTML.
 *
 * Docs: https://pi.dev — SDK: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent
} from '@earendil-works/pi-coding-agent';
import { cuid } from '$lib/utils';
import { env } from '../env';

export type PiSessionHandle = {
	id: string;
	session: AgentSession;
	createdAt: string;
};

export type SpawnPiSessionOptions = {
	/** Working directory for the session. Default: process.cwd() */
	cwd?: string;
	/** Override model id (OpenRouter). Default: PI_MODEL ?? OPENROUTER_MODEL */
	modelId?: string;
	/**
	 * `connection` — tool-free ping/smoke session.
	 * `html-edit` — coding agent with read/edit/write over a work directory.
	 */
	purpose?: 'connection' | 'html-edit';
};

const HTML_EDIT_SYSTEM_PROMPT = [
	'You are a coding agent.',
	'Your job is to edit the email/component HTML file in the current working directory using your tools (read, edit, write).',
	'Apply the user instruction to that file.',
	'Prefer editing the target file directly — it already reflects the brand from generation.',
	'Only open files under components/ when the instruction needs a layout/pattern reference.',
	'Preserve email-safe markup (tables, inline CSS, Svelte props/snippets) unless asked to change them.',
	'Do not create unrelated files. Do not leave the work directory.'
].join(' ');

export type PiDesignContext = {
	/**
	 * Full design.md. Prefer only for one-shot generation — omit on Pi edit to avoid
	 * reloading the entire brand doc into context on every tweak.
	 */
	designMd?: string | null;
	components?: Array<{ name: string; description?: string | null; html: string }>;
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

/**
 * Build design-system files for the Pi work directory.
 * design.md is optional and usually omitted for edit sessions (context cost);
 * component HTML refs are the lighter fallback when pattern matching is needed.
 */
export function buildPiDesignWorkspaceFiles(design?: PiDesignContext): Array<{
	relativePath: string;
	content: string;
}> {
	const files: Array<{ relativePath: string; content: string }> = [];
	const designMd = design?.designMd?.trim() ?? '';
	const components = design?.components?.filter((c) => c.html?.trim()) ?? [];

	if (designMd) {
		files.push({ relativePath: 'design.md', content: designMd.endsWith('\n') ? designMd : `${designMd}\n` });
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
				c.description?.trim() ? `<!-- ${c.name}: ${c.description.trim()} -->` : `<!-- ${c.name} -->`,
				''
			].join('\n');
			files.push({
				relativePath,
				content: `${header}${c.html.trim()}\n`
			});
			indexLines.push(`- \`${relativePath}\` — ${c.name}${c.description?.trim() ? `: ${c.description.trim()}` : ''}`);
		}
		indexLines.push('');
		files.push({ relativePath: 'components/README.md', content: indexLines.join('\n') });
	}

	return files;
}

export function buildPiAgentsMd(opts: {
	filename: string;
	metaLines: string[];
	designFiles: Array<{ relativePath: string }>;
}): string {
	const hasDesignMd = opts.designFiles.some((f) => f.relativePath === 'design.md');
	const componentFiles = opts.designFiles.filter((f) => f.relativePath.startsWith('components/'));
	const designSection: string[] = [];
	if (hasDesignMd || componentFiles.length > 0) {
		designSection.push('## Optional design references', '');
		designSection.push('- Edit the target file first; it already carries the generated brand.');
		if (hasDesignMd) {
			designSection.push('- `design.md` is available — open it only if the instruction needs brand tokens not obvious from the file.');
		}
		if (componentFiles.length > 0) {
			designSection.push('- `components/` has reference HTML patterns — open only when matching an existing pattern.');
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
		'- Keep email-safe HTML (tables + inline CSS) unless asked otherwise.',
		'- Preserve `{{placeholders}}` unless asked to change them.',
		'- Do not modify files outside this directory.',
		'- Do not overwrite design.md or components/; they are read-only context.'
	].join('\n');
}

type PiRegistryEntry = PiSessionHandle;

const registry = new Map<string, PiRegistryEntry>();

let runtimePromise: Promise<ModelRuntime> | null = null;

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
		openRouterApiKey: env.OPENROUTER_API_KEY
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
		throw new Error('Pi is not configured (set OPENROUTER_API_KEY, or PI_ENABLED=false to disable)');
	}

	const agentDir = resolvePiAgentDir();
	await mkdir(agentDir, { recursive: true });

	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, 'auth.json'),
		modelsPath: join(agentDir, 'models.json')
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

export async function spawnPiSession(
	opts: SpawnPiSessionOptions = {}
): Promise<PiSessionHandle> {
	const modelRuntime = await getSharedRuntime();
	const modelId = getPiModelId(opts.modelId);
	const model = modelRuntime.getModel('openrouter', modelId);
	if (!model) {
		throw new Error(
			`Pi model not found for openrouter/${modelId}. Check PI_MODEL / OPENROUTER_MODEL.`
		);
	}

	const cwd = opts.cwd ?? process.cwd();
	const agentDir = resolvePiAgentDir();
	const purpose = opts.purpose ?? 'connection';
	const settingsManager = SettingsManager.inMemory();
	const isHtmlEdit = purpose === 'html-edit';

	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		// html-edit: allow AGENTS.md in the work dir; connection: no project context
		noContextFiles: !isHtmlEdit,
		...(isHtmlEdit
			? { systemPrompt: HTML_EDIT_SYSTEM_PROMPT }
			: {
					agentsFilesOverride: () => ({ agentsFiles: [] }),
					systemPrompt: 'You are a minimal connectivity probe. Reply briefly.'
				})
	});
	await resourceLoader.reload();

	let session: AgentSession | undefined;
	try {
		const result = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime,
			model,
			// HTML edits: enable thinking so the UI can stream it. Connection probes stay quiet.
			thinkingLevel: isHtmlEdit ? 'low' : 'off',
			...(isHtmlEdit
				? { tools: ['read', 'edit', 'write'] }
				: { noTools: 'all' as const }),
			resourceLoader,
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager
		});
		session = result.session;

		const handle: PiSessionHandle = {
			id: cuid(),
			session,
			createdAt: new Date().toISOString()
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
	| { type: 'thinking'; delta: string }
	| { type: 'text'; delta: string }
	| { type: 'tool_start'; toolName: string; detail?: string }
	| { type: 'tool_end'; toolName: string; isError?: boolean; detail?: string }
	| { type: 'done'; html: string; message?: string }
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
			text =
				typeof path === 'string'
					? path
					: JSON.stringify(value);
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
					? (event as { turnIndex: number }).turnIndex
					: undefined;
			return {
				type: 'step',
				message: turnIndex != null ? `Turn ${turnIndex + 1}` : 'Working…'
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
				detail: summarizeForStream(e.args)
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
				detail: summarizeForStream(e.result)
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
	sessionOrHandle: AgentSession | PiSessionHandle
): Promise<string> {
	return promptPiSession(sessionOrHandle, 'Reply with exactly: pong');
}

/**
 * Send a prompt and wait until the agent is idle (tools included).
 * Returns collected assistant text for debugging — not used as HTML source.
 */
export async function promptPiSession(
	sessionOrHandle: AgentSession | PiSessionHandle,
	prompt: string
): Promise<string> {
	const session = 'session' in sessionOrHandle ? sessionOrHandle.session : sessionOrHandle;
	const sink = { text: '' };
	const unsubscribe = session.subscribe((event: AgentSessionEvent) =>
		collectTextDelta(event, sink)
	);

	try {
		await session.prompt(prompt);
		await session.agent.waitForIdle();
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

export type EditHtmlWithPiInput = {
	html: string;
	instruction: string;
	/** Override work-file name (default email.html / component.html). */
	filename?: string;
	context?: {
		kind?: 'component' | 'template';
		name?: string;
		description?: string | null;
		subject?: string;
	};
	/**
	 * Optional design references for the work directory.
	 * For template edits, omit `designMd` — generation already applied it; re-injecting
	 * the full doc on every Pi tweak is unnecessary context cost.
	 */
	design?: PiDesignContext;
	/** Abort signal (SSE client disconnect / Stop). */
	signal?: AbortSignal;
	/** Live progress for SSE clients. */
	onEvent?: (event: PiEditStreamEvent) => void;
};

/**
 * Let Pi edit HTML as a coding agent:
 * 1. Write current HTML into an isolated work directory
 * 2. Inject optional design refs (prefer components/; skip design.md on edits)
 * 3. Spawn Pi with read/edit/write tools in that directory
 * 4. Instruct Pi to change the file (optionally streaming progress)
 * 5. Read the file back and return it for the UI/DB
 */
export async function editHtmlWithPi(input: EditHtmlWithPiInput): Promise<string> {
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

	const workId = cuid();
	const workDir = join(resolvePiWorkRoot(), workId);
	const filename =
		input.filename ??
		(input.context?.kind === 'component' ? 'component.html' : 'email.html');
	const filePath = join(workDir, filename);

	await mkdir(workDir, { recursive: true });
	await writeFile(filePath, input.html.trim() ? input.html : '<!-- empty -->\n', 'utf8');

	const designFiles = buildPiDesignWorkspaceFiles(input.design);
	for (const file of designFiles) {
		const absolute = join(workDir, file.relativePath);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, file.content, 'utf8');
	}

	const metaLines = [
		input.context?.kind ? `- kind: ${input.context.kind}` : null,
		input.context?.name ? `- name: ${input.context.name}` : null,
		input.context?.description ? `- description: ${input.context.description}` : null,
		input.context?.subject ? `- subject: ${input.context.subject}` : null
	].filter((line): line is string => Boolean(line));

	await writeFile(
		join(workDir, 'AGENTS.md'),
		buildPiAgentsMd({ filename, metaLines, designFiles }),
		'utf8'
	);

	emit({ type: 'step', message: 'Starting Pi…' });

	const handle = await spawnPiSession({ purpose: 'html-edit', cwd: workDir });
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

		const designHint =
			designFiles.length > 0
				? [
						'',
						'## Optional references (do not read unless needed)',
						'Edit the target file directly. Open these only if the instruction needs a brand/pattern lookup:',
						...designFiles
							.filter((f) => f.relativePath !== 'components/README.md')
							.map((f) => `- ${f.relativePath}`)
					]
				: [];

		await handle.session.prompt(
			[
				`Open and edit \`${filename}\` in the current working directory.`,
				`Absolute path: ${filePath}`,
				'',
				'## Instruction',
				instruction,
				...designHint,
				'',
				'Use your read/edit/write tools to apply the change to that file.',
				'When done, the updated HTML must be saved in that file.'
			].join('\n')
		);
		await handle.session.agent.waitForIdle();

		if (input.signal?.aborted) {
			const err = new Error('Edit cancelled');
			err.name = 'AbortError';
			throw err;
		}

		const edited = await readFile(filePath, 'utf8');
		if (!looksLikeHtml(edited)) {
			throw new Error(
				`Pi finished but \`${filename}\` does not look like markup. The file was not applied.`
			);
		}
		return edited;
	} finally {
		input.signal?.removeEventListener('abort', onAbort);
		unsubscribe();
		disposePiSession(handle.id);
		await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * Same as {@link editHtmlWithPi} but requires an `onEvent` callback for SSE streaming.
 */
export async function editHtmlWithPiStream(
	input: EditHtmlWithPiInput & { onEvent: (event: PiEditStreamEvent) => void }
): Promise<string> {
	return editHtmlWithPi(input);
}
