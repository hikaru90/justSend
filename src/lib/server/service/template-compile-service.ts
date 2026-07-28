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
					propsPattern = { start: decl.id.start, end: decl.id.end, names };
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

	const scriptOpen = source.match(/<script\b[^>]*>/i);
	if (scriptOpen && scriptOpen.index != null) {
		const insertAt = scriptOpen.index + scriptOpen[0].length;
		return `${source.slice(0, insertAt)}\n\tlet { ${injection} } = $props();${source.slice(insertAt)}`;
	}

	return `<script>\n\tlet { ${injection} } = $props();\n</script>\n${source}`;
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
	const healed = healMissingPropBindings(source);
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
