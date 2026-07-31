import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { compile, parse } from 'svelte/compiler';
import type { Component } from 'svelte';
import {
	listComponentsByTemplateId,
	type TemplateComponent
} from './template-component-service';

export type CompileTarget = 'server' | 'client';

export type CompiledComponentMap = {
	rootName: string;
	/** Component name → compiled JS (ESM, before linking) */
	jsByName: Record<string, string>;
	/** Warnings from svelte/compiler */
	warnings: Array<{ name: string; message: string; code?: string }>;
};

export type LinkedBundle = {
	rootName: string;
	/** Fully bundled ESM source ready to evaluate */
	code: string;
	css: string;
};

export class TemplateCompileError extends Error {
	constructor(
		message: string,
		public readonly componentName?: string
	) {
		super(message);
		this.name = 'TemplateCompileError';
	}
}

const CACHE_LIMIT = 64;
const compileCache = new Map<string, { js: string; css: string; warnings: CompiledComponentMap['warnings'] }>();

/** Identifiers that may appear in markup expressions without being props. */
const TEMPLATE_GLOBALS = new Set([
	'true',
	'false',
	'null',
	'undefined',
	'NaN',
	'Infinity',
	'Math',
	'Number',
	'String',
	'Boolean',
	'Array',
	'Object',
	'JSON',
	'Date',
	'console'
]);

function hashSource(source: string, generate: CompileTarget): string {
	return createHash('sha256').update(`${generate}\0${source}`).digest('hex');
}

function walkAst(node: unknown, visit: (n: Record<string, unknown>) => void): void {
	if (!node || typeof node !== 'object') return;
	const n = node as Record<string, unknown>;
	if (typeof n.type === 'string') visit(n);
	for (const value of Object.values(n)) {
		if (Array.isArray(value)) {
			for (const child of value) walkAst(child, visit);
		} else if (value && typeof value === 'object') {
			walkAst(value, visit);
		}
	}
}

function propsPatternNames(pattern: Record<string, unknown>): string[] {
	const names: string[] = [];
	const properties = pattern.properties;
	if (!Array.isArray(properties)) return names;
	for (const prop of properties) {
		if (!prop || typeof prop !== 'object') continue;
		const p = prop as Record<string, unknown>;
		if (p.type === 'RestElement') {
			const arg = p.argument as Record<string, unknown> | undefined;
			if (arg?.type === 'Identifier' && typeof arg.name === 'string') names.push(arg.name);
			continue;
		}
		if (p.type === 'Property' || p.type === 'AssignmentProperty') {
			const value = p.value as Record<string, unknown> | undefined;
			if (value?.type === 'Identifier' && typeof value.name === 'string') {
				names.push(value.name);
			} else if (value?.type === 'AssignmentPattern') {
				const left = value.left as Record<string, unknown> | undefined;
				if (left?.type === 'Identifier' && typeof left.name === 'string') names.push(left.name);
			} else {
				const key = p.key as Record<string, unknown> | undefined;
				if (key?.type === 'Identifier' && typeof key.name === 'string') names.push(key.name);
			}
		}
	}
	return names;
}

/**
 * AI-generated email components often reference props in markup (or via `{logo_url}`
 * shorthand) without listing them in `$props()`. That throws ReferenceError at SSR.
 * Inject any missing snake_case / lowercase identifiers into `$props()` with `= ''`.
 */
export function healMissingPropBindings(source: string): string {
	let ast;
	try {
		ast = parse(source, { filename: 'Heal.svelte', modern: true });
	} catch {
		return source;
	}

	const declared = new Set<string>();
	let propsPattern: { start: number; end: number; names: string[] } | null = null;

	if (ast.instance) {
		for (const stmt of ast.instance.content.body) {
			if (stmt.type === 'ImportDeclaration') {
				for (const spec of stmt.specifiers) {
					declared.add(spec.local.name);
				}
				continue;
			}
			if (stmt.type !== 'VariableDeclaration') continue;
			for (const decl of stmt.declarations) {
				if (
					decl.init?.type === 'CallExpression' &&
					decl.init.callee.type === 'Identifier' &&
					decl.init.callee.name === '$props' &&
					decl.id.type === 'ObjectPattern'
				) {
					const names = propsPatternNames(decl.id as unknown as Record<string, unknown>);
					for (const name of names) declared.add(name);
					const objectPattern = decl.id as typeof decl.id & { start?: number; end?: number };
					propsPattern = {
						start: objectPattern.start ?? 0,
						end: objectPattern.end ?? 0,
						names
					};
				}
			}
		}
	}

	// Block-scoped bindings from {#each}, {#await}, {#snippet}, let: directives.
	const blockBound = new Set<string>();
	const fragment = (ast as { fragment?: unknown }).fragment ?? (ast as { html?: unknown }).html;
	walkAst(fragment, (node) => {
		if (node.type === 'LetDirective' || node.type === 'BindDirective') {
			const name = (node.name as string | undefined) ?? (node.id as { name?: string } | undefined)?.name;
			if (typeof name === 'string') blockBound.add(name);
		}
		if (node.type === 'EachBlock') {
			const context = node.context as Record<string, unknown> | undefined;
			if (context?.type === 'Identifier' && typeof context.name === 'string') {
				blockBound.add(context.name);
			}
			const key = node.key as Record<string, unknown> | undefined;
			if (key?.type === 'Identifier' && typeof key.name === 'string') {
				// key expression uses outer scope — not a binding
			}
			const index = node.index;
			if (typeof index === 'string') blockBound.add(index);
		}
		if (node.type === 'AwaitBlock') {
			for (const key of ['value', 'error'] as const) {
				const binding = node[key] as Record<string, unknown> | undefined;
				if (binding?.type === 'Identifier' && typeof binding.name === 'string') {
					blockBound.add(binding.name);
				}
			}
		}
		if (node.type === 'SnippetBlock') {
			const params = node.parameters;
			if (Array.isArray(params)) {
				for (const param of params) {
					if (
						param &&
						typeof param === 'object' &&
						(param as { type?: string }).type === 'Identifier' &&
						typeof (param as { name?: string }).name === 'string'
					) {
						blockBound.add((param as { name: string }).name);
					}
				}
			}
		}
	});

	const used = new Set<string>();
	walkAst(fragment, (node) => {
		if (node.type !== 'Identifier') return;
		const name = node.name;
		if (typeof name !== 'string') return;
		// Component tags / PascalCase are not props.
		if (!/^[a-z][a-z0-9_]*$/.test(name)) return;
		if (TEMPLATE_GLOBALS.has(name)) return;
		used.add(name);
	});

	const missing = [...used].filter((name) => !declared.has(name) && !blockBound.has(name));
	if (missing.length === 0) return source;

	missing.sort();
	const injection = missing.map((name) => `${name} = ''`).join(', ');

	if (propsPattern) {
		const inner = source.slice(propsPattern.start + 1, propsPattern.end - 1).trim();
		const nextInner = inner ? `${inner}, ${injection}` : injection;
		return `${source.slice(0, propsPattern.start)}{ ${nextInner} }${source.slice(propsPattern.end)}`;
	}

	// Prefer the instance <script>, not <script module>.
	const scriptOpen = source.match(/<script(?![^>]*\bmodule\b)(\s[^>]*)?>/i);
	if (scriptOpen && scriptOpen.index != null) {
		const insertAt = scriptOpen.index + scriptOpen[0].length;
		return `${source.slice(0, insertAt)}\n\tlet { ${injection} } = $props();${source.slice(insertAt)}`;
	}

	return `<script>\n\tlet { ${injection} } = $props();\n</script>\n${source}`;
}

type TopLevelScriptMatch = {
	start: number;
	end: number;
	attrs: string;
	body: string;
	isModule: boolean;
};

/** Find top-level `<script>` / `<script module>` blocks (non-greedy body match). */
export function findTopLevelScripts(source: string): TopLevelScriptMatch[] {
	const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
	const matches: TopLevelScriptMatch[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(source)) !== null) {
		const attrs = m[1] ?? '';
		matches.push({
			start: m.index,
			end: m.index + m[0].length,
			attrs,
			body: m[2] ?? '',
			isModule: /\bmodule\b/i.test(attrs)
		});
	}
	return matches;
}

/**
 * Svelte allows at most one instance `<script>` and one `<script module>`.
 * AI/Pi sometimes emits two instance scripts (imports in one, $props in another).
 * Merge duplicates so parse can succeed (`script_duplicate`).
 */
export function healDuplicateScripts(source: string): string {
	const scripts = findTopLevelScripts(source);
	const instance = scripts.filter((s) => !s.isModule);
	const modules = scripts.filter((s) => s.isModule);
	if (instance.length <= 1 && modules.length <= 1) return source;

	type Edit = { start: number; end: number; text: string };
	const edits: Edit[] = [];

	const mergeGroup = (group: TopLevelScriptMatch[]) => {
		if (group.length <= 1) return;
		const mergedBody = group
			.map((s) => s.body.replace(/^\n+|\n+$/g, '').trimEnd())
			.filter((b) => b.trim().length > 0)
			.join('\n\n');
		const first = group[0];
		edits.push({
			start: first.start,
			end: first.end,
			text: `<script${first.attrs}>\n${mergedBody}\n</script>`
		});
		for (const extra of group.slice(1)) {
			let end = extra.end;
			if (source[end] === '\n') end += 1;
			else if (source.startsWith('\r\n', end)) end += 2;
			// Drop a blank line left behind when possible.
			if (source[end] === '\n') end += 1;
			edits.push({ start: extra.start, end, text: '' });
		}
	};

	mergeGroup(instance);
	mergeGroup(modules);

	edits.sort((a, b) => b.start - a.start);
	let out = source;
	for (const edit of edits) {
		out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
	}
	return out;
}

function isWhitespaceTextNode(node: Record<string, unknown>): boolean {
	if (node.type !== 'Text') return false;
	const data = typeof node.data === 'string' ? node.data : typeof node.raw === 'string' ? node.raw : '';
	return /^\s*$/.test(data);
}

function isDirectTableTr(node: Record<string, unknown>): boolean {
	return node.type === 'RegularElement' && node.name === 'tr';
}

/**
 * Svelte 5 rejects `<tr>` as a direct child of `<table>` (`node_invalid_placement`).
 * Email HTML often omits `<tbody>`; wrap consecutive bare `<tr>` runs so compile succeeds.
 */
export function healTableRowPlacement(source: string): string {
	let ast;
	try {
		ast = parse(source, { filename: 'HealTable.svelte', modern: true });
	} catch {
		return source;
	}

	const wraps: Array<{ start: number; end: number }> = [];

	const visit = (node: unknown): void => {
		if (!node || typeof node !== 'object') return;
		const n = node as Record<string, unknown>;

		if (n.type === 'RegularElement' && n.name === 'table') {
			const fragment = n.fragment as { nodes?: unknown[] } | undefined;
			const children = fragment?.nodes ?? [];
			let runStart: number | null = null;
			let runEnd: number | null = null;
			let hasTr = false;

			const flush = () => {
				if (hasTr && runStart != null && runEnd != null) {
					wraps.push({ start: runStart, end: runEnd });
				}
				runStart = null;
				runEnd = null;
				hasTr = false;
			};

			for (const child of children) {
				if (!child || typeof child !== 'object') {
					flush();
					continue;
				}
				const c = child as Record<string, unknown>;
				const start = typeof c.start === 'number' ? c.start : null;
				const end = typeof c.end === 'number' ? c.end : null;
				if (isDirectTableTr(c) && start != null && end != null) {
					if (runStart == null) runStart = start;
					runEnd = end;
					hasTr = true;
					continue;
				}
				if (isWhitespaceTextNode(c) && hasTr && start != null && end != null) {
					runEnd = end;
					continue;
				}
				flush();
			}
			flush();
		}

		for (const value of Object.values(n)) {
			if (Array.isArray(value)) {
				for (const child of value) visit(child);
			} else if (value && typeof value === 'object') {
				visit(value);
			}
		}
	};

	const fragment = (ast as { fragment?: unknown }).fragment ?? (ast as { html?: unknown }).html;
	visit(fragment);

	if (wraps.length === 0) return source;

	const open = '<tbody>';
	const close = '</tbody>';
	// Innermost / later ranges first; adjust remaining ranges that contain them.
	const adjusted = [...wraps].sort((a, b) => b.start - a.start || b.end - a.end);
	let out = source;

	for (let i = 0; i < adjusted.length; i++) {
		const w = adjusted[i];
		out = `${out.slice(0, w.start)}${open}${out.slice(w.start, w.end)}${close}${out.slice(w.end)}`;
		for (let j = i + 1; j < adjusted.length; j++) {
			const o = adjusted[j];
			if (o.end <= w.start) continue;
			if (o.start >= w.end) {
				o.start += open.length + close.length;
				o.end += open.length + close.length;
			} else if (o.start <= w.start && o.end >= w.end) {
				o.end += open.length + close.length;
			}
		}
	}

	return out;
}

/** Prop names declared via `let { … } = $props()` (after healing). */
export function extractPropNames(source: string): string[] {
	const healed = healMissingPropBindings(source);
	let ast;
	try {
		ast = parse(healed, { filename: 'Props.svelte', modern: true });
	} catch {
		return [];
	}
	if (!ast.instance) return [];
	const names: string[] = [];
	for (const stmt of ast.instance.content.body) {
		if (stmt.type !== 'VariableDeclaration') continue;
		for (const decl of stmt.declarations) {
			if (
				decl.init?.type === 'CallExpression' &&
				decl.init.callee.type === 'Identifier' &&
				decl.init.callee.name === '$props' &&
				decl.id.type === 'ObjectPattern'
			) {
				names.push(...propsPatternNames(decl.id as unknown as Record<string, unknown>));
			}
		}
	}
	return names;
}

function cacheGet(key: string) {
	const hit = compileCache.get(key);
	if (!hit) return undefined;
	// LRU: re-insert
	compileCache.delete(key);
	compileCache.set(key, hit);
	return hit;
}

function cacheSet(
	key: string,
	value: { js: string; css: string; warnings: CompiledComponentMap['warnings'] }
) {
	compileCache.set(key, value);
	while (compileCache.size > CACHE_LIMIT) {
		const oldest = compileCache.keys().next().value;
		if (oldest === undefined) break;
		compileCache.delete(oldest);
	}
}

/**
 * Security boundary: allow a single instance `<script>` that only contains
 * relative `.svelte` imports and `$props()` destructuring. Reject `<script module>`
 * and any other JavaScript.
 */
export function assertSafeEmailComponentSource(source: string, componentName = 'Component'): void {
	let ast;
	try {
		ast = parse(source, { filename: `${componentName}.svelte`, modern: true });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new TemplateCompileError(`Parse error in ${componentName}: ${msg}`, componentName);
	}

	if (ast.module) {
		throw new TemplateCompileError(
			`${componentName}: <script module> is not allowed in email components`,
			componentName
		);
	}

	if (!ast.instance) return;

	const program = ast.instance.content;
	for (const stmt of program.body) {
		if (stmt.type === 'ImportDeclaration') {
			const src = stmt.source.value;
			if (typeof src !== 'string') {
				throw new TemplateCompileError(
					`${componentName}: invalid import source`,
					componentName
				);
			}
			if (!src.startsWith('./') || !src.endsWith('.svelte')) {
				throw new TemplateCompileError(
					`${componentName}: only relative .svelte imports are allowed (got "${src}")`,
					componentName
				);
			}
			continue;
		}

		if (stmt.type === 'VariableDeclaration') {
			for (const decl of stmt.declarations) {
				if (!decl.init || decl.init.type !== 'CallExpression') {
					throw new TemplateCompileError(
						`${componentName}: only \`let { … } = $props()\` is allowed in <script>`,
						componentName
					);
				}
				const callee = decl.init.callee;
				if (callee.type !== 'Identifier' || callee.name !== '$props') {
					throw new TemplateCompileError(
						`${componentName}: only \`let { … } = $props()\` is allowed in <script>`,
						componentName
					);
				}
				if (decl.init.arguments.length > 0) {
					throw new TemplateCompileError(
						`${componentName}: $props() must be called with no arguments`,
						componentName
					);
				}
				if (decl.id.type !== 'ObjectPattern') {
					throw new TemplateCompileError(
						`${componentName}: $props() must be destructured`,
						componentName
					);
				}
			}
			continue;
		}

		throw new TemplateCompileError(
			`${componentName}: disallowed statement in <script> (only imports and $props() allowed)`,
			componentName
		);
	}
}

export function compileOneComponent(
	name: string,
	source: string,
	generate: CompileTarget
): { js: string; css: string; warnings: CompiledComponentMap['warnings'] } {
	const healed = healMissingPropBindings(healTableRowPlacement(healDuplicateScripts(source)));
	assertSafeEmailComponentSource(healed, name);

	const key = hashSource(healed, generate);
	const cached = cacheGet(key);
	if (cached) return cached;

	const result = compile(healed, {
		filename: `${name}.svelte`,
		name,
		generate,
		css: 'injected',
		dev: false,
		preserveWhitespace: true
	});

	const warnings = result.warnings.map((w) => ({
		name,
		message: w.message,
		code: w.code
	}));

	const entry = {
		js: result.js.code,
		css: result.css?.code ?? '',
		warnings
	};
	cacheSet(key, entry);
	return entry;
}

export function compileComponentSources(
	components: Array<{ name: string; source: string; kind?: string }>,
	generate: CompileTarget = 'server'
): CompiledComponentMap {
	const root =
		components.find((c) => c.kind === 'root') ??
		components.find((c) => c.name === 'Root') ??
		components[0];
	if (!root) {
		throw new TemplateCompileError('No components to compile');
	}

	const jsByName: Record<string, string> = {};
	const warnings: CompiledComponentMap['warnings'] = [];

	for (const c of components) {
		try {
			const compiled = compileOneComponent(c.name, c.source, generate);
			jsByName[c.name] = compiled.js;
			warnings.push(...compiled.warnings);
		} catch (e) {
			if (e instanceof TemplateCompileError) throw e;
			const msg = e instanceof Error ? e.message : String(e);
			throw new TemplateCompileError(`Compile failed for ${c.name}: ${msg}`, c.name);
		}
	}

	return { rootName: root.name, jsByName, warnings };
}

function componentNameFromImport(path: string): string {
	const cleaned = path.replace(/^\.\//, '').replace(/\.svelte$/, '');
	return cleaned;
}

/**
 * Bundle compiled component JS into a single ESM module with relative imports resolved.
 */
export async function linkCompiledComponents(
	compiled: CompiledComponentMap,
	generate: CompileTarget = 'server'
): Promise<LinkedBundle> {
	const virtualFiles = new Map<string, string>();
	for (const [name, js] of Object.entries(compiled.jsByName)) {
		virtualFiles.set(`${name}.svelte`, js);
		virtualFiles.set(`./${name}.svelte`, js);
		virtualFiles.set(name, js);
	}

	const rootEntry = `${compiled.rootName}.svelte`;
	if (!virtualFiles.has(rootEntry)) {
		throw new TemplateCompileError(`Root component "${compiled.rootName}" missing from compile map`);
	}

	const result = await esbuild.build({
		stdin: {
			contents: virtualFiles.get(rootEntry)!,
			sourcefile: rootEntry,
			loader: 'js',
			resolveDir: '/'
		},
		bundle: true,
		write: false,
		format: 'esm',
		platform: generate === 'server' ? 'node' : 'browser',
		target: generate === 'server' ? 'node22' : 'es2022',
		external: ['svelte', 'svelte/*'],
		plugins: [
			{
				name: 'owlery-virtual-svelte',
				setup(build) {
					build.onResolve({ filter: /.*/ }, (args) => {
						if (args.path.startsWith('svelte')) {
							return { path: args.path, external: true };
						}
						const name = componentNameFromImport(args.path);
						if (compiled.jsByName[name]) {
							return { path: name, namespace: 'owlery-comp' };
						}
						if (args.path === rootEntry || args.path === `./${rootEntry}`) {
							return { path: compiled.rootName, namespace: 'owlery-comp' };
						}
						return undefined;
					});
					build.onLoad({ filter: /.*/, namespace: 'owlery-comp' }, (args) => {
						const js = compiled.jsByName[args.path];
						if (!js) {
							return {
								errors: [{ text: `Unknown component "${args.path}"` }]
							};
						}
						return { contents: js, loader: 'js' };
					});
				}
			}
		]
	});

	if (result.errors.length > 0) {
		throw new TemplateCompileError(
			`Bundle failed: ${result.errors.map((e) => e.text).join('; ')}`
		);
	}

	const code = result.outputFiles?.[0]?.text;
	if (!code) {
		throw new TemplateCompileError('Bundle produced no output');
	}

	return {
		rootName: compiled.rootName,
		code,
		css: ''
	};
}

export async function compileTemplateComponents(
	templateId: string,
	generate: CompileTarget = 'server'
): Promise<{ compiled: CompiledComponentMap; linked: LinkedBundle; components: TemplateComponent[] }> {
	const components = listComponentsByTemplateId(templateId);
	if (components.length === 0) {
		throw new TemplateCompileError('Template has no Svelte components — regenerate it');
	}

	const compiled = compileComponentSources(components, generate);
	const linked = await linkCompiledComponents(compiled, generate);
	return { compiled, linked, components };
}

/**
 * Evaluate a linked ESM bundle and return the default export (the root component).
 * Uses a data URL so Node can `import()` it; svelte stays external and resolves from node_modules.
 */
export async function loadLinkedComponent(linked: LinkedBundle): Promise<Component> {
	// Rewrite bare `svelte/...` imports to absolute file URLs so data: imports resolve.
	const rewritten = await rewriteSvelteImportsToFileUrls(linked.code);
	const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(rewritten)}`;
	const mod = (await import(/* @vite-ignore */ dataUrl)) as { default: Component };
	if (!mod?.default) {
		throw new TemplateCompileError('Linked bundle did not export a default component');
	}
	return mod.default;
}

async function rewriteSvelteImportsToFileUrls(code: string): Promise<string> {
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);

	return code.replace(
		/(from\s*['"])(svelte(?:\/[^'"]*)?)(['"])/g,
		(_full, pre: string, spec: string, post: string) => {
			try {
				const resolved = require.resolve(spec);
				return `${pre}${pathToFileURL(resolved).href}${post}`;
			} catch {
				return `${pre}${spec}${post}`;
			}
		}
	);
}

/** Validate source compiles (server) without linking — used during generation. */
export function validateComponentSource(name: string, source: string): void {
	compileOneComponent(name, source, 'server');
}
