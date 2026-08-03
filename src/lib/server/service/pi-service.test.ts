import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
	buildPiAgentsMd,
	buildPiDesignWorkspaceFiles,
	buildPiEmailTreeAgentsMd,
	disposeAllPiSessions,
	disposePiSession,
	getPiModelId,
	getPiSession,
	isPiConfigured,
	listPiSessions,
	looksLikeHtml,
	mapAgentSessionEventToPiEdit,
	piAssetRelativePath,
	pingPiSession,
	readPiEmailTree,
	resetPiRuntimeCache,
	resolvePiConfigured,
	safePiEmailComponentFilename,
	slugifyPiComponentFilename,
	spawnPiSession,
} from './pi-service';

describe('resolvePiConfigured', () => {
	it('returns false when explicitly disabled', () => {
		expect(resolvePiConfigured({ piEnabled: false, openRouterApiKey: 'sk-test' })).toBe(false);
	});

	it('returns true when key present and enabled/unset', () => {
		expect(resolvePiConfigured({ piEnabled: undefined, openRouterApiKey: 'sk-test' })).toBe(true);
		expect(resolvePiConfigured({ piEnabled: true, openRouterApiKey: 'sk-test' })).toBe(true);
	});

	it('returns false when key missing', () => {
		expect(resolvePiConfigured({ piEnabled: undefined, openRouterApiKey: undefined })).toBe(false);
		expect(resolvePiConfigured({ piEnabled: true, openRouterApiKey: '  ' })).toBe(false);
	});
});

describe('getPiModelId', () => {
	it('prefers override then falls back to env defaults', () => {
		expect(getPiModelId('  custom/model  ')).toBe('custom/model');
		expect(getPiModelId()).toBeTruthy();
	});
});

describe('pi session registry', () => {
	afterEach(() => {
		disposeAllPiSessions();
		resetPiRuntimeCache();
	});

	it('get/dispose unknown ids safely', () => {
		expect(getPiSession('missing')).toBeUndefined();
		expect(disposePiSession('missing')).toBe(false);
		expect(listPiSessions()).toEqual([]);
		expect(disposeAllPiSessions()).toBe(0);
	});

	it('isPiConfigured matches OPENROUTER_API_KEY presence (unless PI_ENABLED=false)', () => {
		const configured = isPiConfigured();
		const hasKey = Boolean(process.env.OPENROUTER_API_KEY?.trim());
		const disabled = process.env.PI_ENABLED === 'false' || process.env.PI_ENABLED === '0';
		expect(configured).toBe(hasKey && !disabled);
	});
});

describe('looksLikeHtml', () => {
	it('accepts real HTML', () => {
		expect(looksLikeHtml('<table><tr><td>Hi</td></tr></table>')).toBe(true);
		expect(looksLikeHtml('<!doctype html><html><body></body></html>')).toBe(true);
	});

	it('rejects plain text', () => {
		expect(looksLikeHtml('ts find: email templates OR header component in project')).toBe(false);
		expect(looksLikeHtml('just some notes')).toBe(false);
	});
});

describe('mapAgentSessionEventToPiEdit', () => {
	it('maps thinking and text deltas', () => {
		expect(
			mapAgentSessionEventToPiEdit({
				type: 'message_update',
				assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
			} as AgentSessionEvent),
		).toEqual({ type: 'thinking', delta: 'hmm' });

		expect(
			mapAgentSessionEventToPiEdit({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', delta: 'hi' },
			} as AgentSessionEvent),
		).toEqual({ type: 'text', delta: 'hi' });
	});

	it('maps tool start/end and steps', () => {
		expect(mapAgentSessionEventToPiEdit({ type: 'agent_start' } as AgentSessionEvent)).toEqual({
			type: 'step',
			message: 'Pi started',
		});
		expect(
			mapAgentSessionEventToPiEdit({
				type: 'tool_execution_start',
				toolName: 'read',
				args: { path: 'email.html' },
			} as AgentSessionEvent),
		).toEqual({ type: 'tool_start', toolName: 'read', detail: 'email.html' });
		expect(
			mapAgentSessionEventToPiEdit({
				type: 'tool_execution_end',
				toolName: 'edit',
				result: { ok: true },
				isError: false,
			} as AgentSessionEvent),
		).toEqual({
			type: 'tool_end',
			toolName: 'edit',
			isError: false,
			detail: '{"ok":true}',
		});
	});

	it('skips irrelevant events', () => {
		expect(mapAgentSessionEventToPiEdit({ type: 'agent_settled' } as AgentSessionEvent)).toBeNull();
	});
});

describe('slugifyPiComponentFilename', () => {
	it('slugifies names', () => {
		expect(slugifyPiComponentFilename('Header CTA')).toBe('header-cta');
		expect(slugifyPiComponentFilename('  ')).toBe('component');
	});
});

describe('buildPiDesignWorkspaceFiles', () => {
	it('writes design.md when present', () => {
		const files = buildPiDesignWorkspaceFiles({ designMd: '# Brand\nPrimary: #111' });
		expect(files.map((f) => f.relativePath)).toEqual(['design.md']);
		expect(files[0].content).toContain('# Brand');
	});

	it('writes components when design.md is missing', () => {
		const files = buildPiDesignWorkspaceFiles({
			components: [{ name: 'Button', description: 'Primary', html: '<a class="btn">Go</a>' }],
		});
		expect(files.map((f) => f.relativePath)).toEqual([
			'components/button.html',
			'components/README.md',
		]);
		expect(files[0].content).toContain('<a class="btn">Go</a>');
	});

	it('writes both design.md and components when available', () => {
		const files = buildPiDesignWorkspaceFiles({
			designMd: '# Brand',
			components: [
				{ name: 'Header', html: '<table><tr><td>H</td></tr></table>' },
				{ name: 'Header', html: '<table><tr><td>H2</td></tr></table>' },
			],
		});
		expect(files.map((f) => f.relativePath)).toEqual([
			'design.md',
			'components/header.html',
			'components/header-2.html',
			'components/README.md',
		]);
	});

	it('excludes the component being edited by name', () => {
		const files = buildPiDesignWorkspaceFiles({
			components: [
				{ name: 'Button', html: '<a>A</a>' },
				{ name: 'Header', html: '<table></table>' },
			],
			excludeComponentName: 'Button',
		});
		expect(files.map((f) => f.relativePath)).toEqual([
			'components/header.html',
			'components/README.md',
		]);
		expect(files[0].content).not.toContain('<a>A</a>');
	});

	it('writes assets README with embed URLs', () => {
		const files = buildPiDesignWorkspaceFiles({
			assetBaseUrl: 'http://localhost:5173',
			assets: [
				{
					id: 'asset1',
					kind: 'logo',
					name: 'Light logo',
					filename: 'logo.png',
					mime: 'image/png',
					size: 1200,
				},
			],
		});
		expect(files.map((f) => f.relativePath)).toEqual(['assets/README.md']);
		expect(files[0].content).toContain('assets/logo/asset1-logo.png');
		expect(files[0].content).toContain('http://localhost:5173/api/design-asset/asset1');
		expect(files[0].content).toContain('Light logo');
	});

	it('writes design.md, components, and assets together', () => {
		const files = buildPiDesignWorkspaceFiles({
			designMd: '# Brand',
			components: [{ name: 'CTA', html: '<a>Go</a>' }],
			assets: [
				{
					id: 'img1',
					kind: 'image',
					name: 'Hero',
					filename: 'hero.jpg',
					mime: 'image/jpeg',
					size: 9,
				},
			],
			assetBaseUrl: 'https://owlery.test',
		});
		expect(files.map((f) => f.relativePath)).toEqual([
			'design.md',
			'components/cta.html',
			'components/README.md',
			'assets/README.md',
		]);
		expect(files.find((f) => f.relativePath === 'assets/README.md')?.content).toContain(
			'https://owlery.test/api/design-asset/img1',
		);
	});

	it('returns empty when no design context', () => {
		expect(buildPiDesignWorkspaceFiles()).toEqual([]);
		expect(buildPiDesignWorkspaceFiles({ designMd: '  ', components: [], assets: [] })).toEqual([]);
	});
});

describe('piAssetRelativePath', () => {
	it('builds a safe assets path', () => {
		expect(
			piAssetRelativePath({
				id: 'abc',
				kind: 'font',
				filename: 'Brand Font.woff2',
			}),
		).toBe('assets/font/abc-Brand_Font.woff2');
	});
});

describe('buildPiAgentsMd', () => {
	it('mentions design.md, components, and assets when present', () => {
		const md = buildPiAgentsMd({
			filename: 'email.html',
			metaLines: ['- kind: template'],
			designFiles: [
				{ relativePath: 'design.md' },
				{ relativePath: 'components/button.html' },
				{ relativePath: 'assets/README.md' },
			],
		});
		expect(md).toContain('design.md');
		expect(md).toContain('components/');
		expect(md).toContain('assets/README.md');
		expect(md).toContain('Design library');
		expect(md).toContain('read-only context');
		expect(md).toContain('embed URLs');
		expect(md).toContain('max-width: 620px');
	});

	it('lists components when design.md is absent', () => {
		const md = buildPiAgentsMd({
			filename: 'component.html',
			metaLines: [],
			designFiles: [{ relativePath: 'components/header.html' }],
		});
		expect(md).toContain('Design library');
		expect(md).toContain('components/');
		expect(md).not.toContain('`design.md` — brand');
	});
});

describe('buildPiEmailTreeAgentsMd', () => {
	it('lists email files and multi-file rules', () => {
		const md = buildPiEmailTreeAgentsMd({
			fileNames: ['Root.svelte', 'Header.svelte'],
			metaLines: ['- kind: email-tree'],
			designFiles: [{ relativePath: 'design.md' }],
		});
		expect(md).toContain('email/Root.svelte');
		expect(md).toContain('email/Header.svelte');
		expect(md).toContain('exactly one Root');
		expect(md).toContain('design.md');
		expect(md).toContain('$props()');
		expect(md).toContain('Composition checklist');
	});
});

describe('safePiEmailComponentFilename', () => {
	it('keeps PascalCase names and strips .svelte', () => {
		expect(safePiEmailComponentFilename('Header')).toBe('Header');
		expect(safePiEmailComponentFilename('Root.svelte')).toBe('Root');
		expect(safePiEmailComponentFilename('  Hero CTA  ')).toBe('HeroCTA');
		expect(safePiEmailComponentFilename('!!!')).toBe('Component');
	});
});

describe('readPiEmailTree', () => {
	let dir: string;

	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	});

	it('reads Root first and skips empty files', async () => {
		dir = await mkdtemp(join(tmpdir(), 'owlery-email-tree-'));
		await writeFile(join(dir, 'Header.svelte'), '<table><tr><td>H</td></tr></table>', 'utf8');
		await writeFile(
			join(dir, 'Root.svelte'),
			'<script>import Header from "./Header.svelte";</script>\n<table><Header /></table>',
			'utf8',
		);
		await writeFile(join(dir, 'empty.svelte'), '   \n', 'utf8');

		const tree = await readPiEmailTree(dir);
		expect(tree.map((c) => ({ name: c.name, kind: c.kind }))).toEqual([
			{ name: 'Root', kind: 'root' },
			{ name: 'Header', kind: 'component' },
		]);
		expect(tree[0].order).toBe(0);
		expect(tree[1].order).toBe(1);
	});

	it('throws when email dir is missing', async () => {
		await expect(readPiEmailTree(join(tmpdir(), 'missing-email-dir-xyz'))).rejects.toThrow(
			/email\/ directory is missing/,
		);
	});
});

describe('pingPiSession live', () => {
	afterEach(() => {
		disposeAllPiSessions();
		resetPiRuntimeCache();
	});

	it.skipIf(!process.env.OPENROUTER_API_KEY || process.env.PI_LIVE_TEST !== '1')(
		'spawns a session and receives a reply',
		async () => {
			const handle = await spawnPiSession();
			expect(handle.id).toBeTruthy();
			expect(getPiSession(handle.id)?.id).toBe(handle.id);

			const text = await pingPiSession(handle);
			expect(text.toLowerCase()).toContain('pong');

			expect(disposePiSession(handle.id)).toBe(true);
			expect(getPiSession(handle.id)).toBeUndefined();
		},
		60_000,
	);
});
