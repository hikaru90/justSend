import { afterEach, describe, expect, it } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
	buildPiAgentsMd,
	buildPiDesignWorkspaceFiles,
	disposeAllPiSessions,
	disposePiSession,
	getPiModelId,
	getPiSession,
	isPiConfigured,
	listPiSessions,
	looksLikeHtml,
	mapAgentSessionEventToPiEdit,
	pingPiSession,
	resetPiRuntimeCache,
	resolvePiConfigured,
	slugifyPiComponentFilename,
	spawnPiSession
} from './pi-service';

describe('resolvePiConfigured', () => {
	it('returns false when explicitly disabled', () => {
		expect(
			resolvePiConfigured({ piEnabled: false, openRouterApiKey: 'sk-test' })
		).toBe(false);
	});

	it('returns true when key present and enabled/unset', () => {
		expect(
			resolvePiConfigured({ piEnabled: undefined, openRouterApiKey: 'sk-test' })
		).toBe(true);
		expect(resolvePiConfigured({ piEnabled: true, openRouterApiKey: 'sk-test' })).toBe(true);
	});

	it('returns false when key missing', () => {
		expect(resolvePiConfigured({ piEnabled: undefined, openRouterApiKey: undefined })).toBe(
			false
		);
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
		const disabled =
			process.env.PI_ENABLED === 'false' ||
			process.env.PI_ENABLED === '0';
		expect(configured).toBe(hasKey && !disabled);
	});
});

describe('looksLikeHtml', () => {
	it('accepts real HTML', () => {
		expect(looksLikeHtml('<table><tr><td>Hi</td></tr></table>')).toBe(true);
		expect(looksLikeHtml('<!doctype html><html><body></body></html>')).toBe(true);
	});

	it('rejects plain text', () => {
		expect(looksLikeHtml('ts find: email templates OR header component in project')).toBe(
			false
		);
		expect(looksLikeHtml('just some notes')).toBe(false);
	});
});

describe('mapAgentSessionEventToPiEdit', () => {
	it('maps thinking and text deltas', () => {
		expect(
			mapAgentSessionEventToPiEdit({
				type: 'message_update',
				assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' }
			} as AgentSessionEvent)
		).toEqual({ type: 'thinking', delta: 'hmm' });

		expect(
			mapAgentSessionEventToPiEdit({
				type: 'message_update',
				assistantMessageEvent: { type: 'text_delta', delta: 'hi' }
			} as AgentSessionEvent)
		).toEqual({ type: 'text', delta: 'hi' });
	});

	it('maps tool start/end and steps', () => {
		expect(mapAgentSessionEventToPiEdit({ type: 'agent_start' } as AgentSessionEvent)).toEqual({
			type: 'step',
			message: 'Pi started'
		});
		expect(
			mapAgentSessionEventToPiEdit({
				type: 'tool_execution_start',
				toolName: 'read',
				args: { path: 'email.html' }
			} as AgentSessionEvent)
		).toEqual({ type: 'tool_start', toolName: 'read', detail: 'email.html' });
		expect(
			mapAgentSessionEventToPiEdit({
				type: 'tool_execution_end',
				toolName: 'edit',
				result: { ok: true },
				isError: false
			} as AgentSessionEvent)
		).toEqual({
			type: 'tool_end',
			toolName: 'edit',
			isError: false,
			detail: '{"ok":true}'
		});
	});

	it('skips irrelevant events', () => {
		expect(
			mapAgentSessionEventToPiEdit({ type: 'agent_settled' } as AgentSessionEvent)
		).toBeNull();
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
			components: [{ name: 'Button', description: 'Primary', html: '<a class="btn">Go</a>' }]
		});
		expect(files.map((f) => f.relativePath)).toEqual([
			'components/button.html',
			'components/README.md'
		]);
		expect(files[0].content).toContain('<a class="btn">Go</a>');
	});

	it('writes both design.md and components when available', () => {
		const files = buildPiDesignWorkspaceFiles({
			designMd: '# Brand',
			components: [
				{ name: 'Header', html: '<table><tr><td>H</td></tr></table>' },
				{ name: 'Header', html: '<table><tr><td>H2</td></tr></table>' }
			]
		});
		expect(files.map((f) => f.relativePath)).toEqual([
			'design.md',
			'components/header.html',
			'components/header-2.html',
			'components/README.md'
		]);
	});

	it('returns empty when no design context', () => {
		expect(buildPiDesignWorkspaceFiles()).toEqual([]);
		expect(buildPiDesignWorkspaceFiles({ designMd: '  ', components: [] })).toEqual([]);
	});
});

describe('buildPiAgentsMd', () => {
	it('mentions design.md and components as optional when present', () => {
		const md = buildPiAgentsMd({
			filename: 'email.html',
			metaLines: ['- kind: template'],
			designFiles: [
				{ relativePath: 'design.md' },
				{ relativePath: 'components/button.html' }
			]
		});
		expect(md).toContain('design.md');
		expect(md).toContain('components/');
		expect(md).toContain('only if');
		expect(md).toContain('read-only context');
	});

	it('lists components as optional refs when design.md is absent', () => {
		const md = buildPiAgentsMd({
			filename: 'component.html',
			metaLines: [],
			designFiles: [{ relativePath: 'components/header.html' }]
		});
		expect(md).toContain('Optional design references');
		expect(md).toContain('components/');
		expect(md).not.toContain('Read `design.md` before editing');
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
		60_000
	);
});
