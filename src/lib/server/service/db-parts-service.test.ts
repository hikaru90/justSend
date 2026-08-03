import { describe, it, expect, beforeEach } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { resetDb } from '../../../tests/helpers/db';
import {
	createDomain,
	createSesSetting,
	createTeam,
	createTemplate,
} from '../../../tests/helpers/factories';
import { cuid } from '$lib/utils';
import { db } from '../db';
import {
	designAssets,
	designComponents,
	designSystems,
	domains,
	sesSettings,
	templates,
} from '../db/schema';
import { exportDbParts, importDbParts, parsePartsList } from './db-parts-service';
import { createZip, readZip } from './parts-zip';

describe('parts-zip', () => {
	it('round-trips store-only entries', () => {
		const zip = createZip([
			{ path: 'manifest.json', data: new TextEncoder().encode('{"ok":true}') },
			{ path: 'assets/a/x.bin', data: new Uint8Array([1, 2, 3, 4]) },
		]);
		const files = readZip(zip);
		expect(files.get('manifest.json')?.toString('utf8')).toBe('{"ok":true}');
		expect([...files.get('assets/a/x.bin')!]).toEqual([1, 2, 3, 4]);
	});
});

describe('db-parts-service', () => {
	beforeEach(() => resetDb());

	it('parsePartsList dedupes and ignores unknown ids', () => {
		expect(parsePartsList('templates,design,templates,nope')).toEqual(['templates', 'design']);
	});

	it('exports and imports ses without touching domains', async () => {
		const team = createTeam();
		createSesSetting({ region: 'eu-central-1', idPrefix: 'eu1' });
		createDomain(team.id, { name: 'keep.example.com' });

		const zip = await exportDbParts({ parts: ['ses'] });
		db.delete(sesSettings).run();
		createSesSetting({ region: 'us-west-2', idPrefix: 'uw2' });

		const summary = await importDbParts({ parts: ['ses'], zipBytes: zip });
		expect(summary.imported.ses?.ses_settings).toBe(1);

		const regions = db
			.select({ region: sesSettings.region })
			.from(sesSettings)
			.all()
			.map((r) => r.region);
		expect(regions).toEqual(['eu-central-1']);
		expect(db.select().from(domains).all()).toHaveLength(1);
	});

	it('imports templates+design onto another team and remaps domain by name', async () => {
		const source = createTeam({ name: 'Source' });
		const target = createTeam({ name: 'Target' });
		const sourceDomain = createDomain(source.id, { name: 'mail.example.com' });

		const tpl = createTemplate(source.id, {
			name: 'Welcome',
			domainId: sourceDomain.id,
			subject: 'Hi',
		});

		const componentId = cuid();
		db.insert(designComponents)
			.values({
				id: componentId,
				teamId: source.id,
				name: 'Header',
				kind: 'custom',
				role: 'section',
				html: '<p>H</p>',
				document: '{}',
				slots: '[]',
			})
			.run();

		db.insert(designSystems).values({ id: cuid(), teamId: source.id, designMd: '# Brand' }).run();

		const assetId = cuid();
		const filename = 'logo.svg';
		const disk = join(
			process.cwd(),
			'data',
			'design',
			String(source.id),
			'logo',
			`${assetId}-logo.svg`,
		);
		await mkdir(dirname(disk), { recursive: true });
		await writeFile(disk, '<svg></svg>');
		db.insert(designAssets)
			.values({
				id: assetId,
				teamId: source.id,
				kind: 'logo',
				name: 'Logo',
				filename,
				mime: 'image/svg+xml',
				size: 11,
			})
			.run();

		const zip = await exportDbParts({
			parts: ['templates', 'design'],
			teamId: source.id,
		});

		// Domain names are globally unique — reassign to target so remap-by-name can resolve.
		db.update(domains).set({ teamId: target.id }).where(eq(domains.id, sourceDomain.id)).run();

		const summary = await importDbParts({
			parts: ['templates', 'design'],
			teamId: target.id,
			zipBytes: zip,
		});

		expect(summary.imported.templates?.templates).toBe(1);
		expect(summary.imported.design?.design_components).toBe(1);

		const importedTpl = db.select().from(templates).where(eq(templates.teamId, target.id)).get();
		expect(importedTpl?.id).toBe(tpl.id);
		expect(importedTpl?.teamId).toBe(target.id);
		expect(importedTpl?.domainId).toBe(sourceDomain.id);

		const targetAsset = db
			.select()
			.from(designAssets)
			.where(eq(designAssets.teamId, target.id))
			.get();
		expect(targetAsset?.id).toBe(assetId);
		const targetDisk = join(
			process.cwd(),
			'data',
			'design',
			String(target.id),
			'logo',
			`${assetId}-logo.svg`,
		);
		expect(await readFile(targetDisk, 'utf8')).toBe('<svg></svg>');

		await rm(join(process.cwd(), 'data', 'design', String(source.id)), {
			recursive: true,
			force: true,
		});
		await rm(join(process.cwd(), 'data', 'design', String(target.id)), {
			recursive: true,
			force: true,
		});
	});

	it('selective import leaves unselected parts untouched', async () => {
		const team = createTeam();
		createSesSetting({ region: 'eu-west-1', idPrefix: 'ew1' });
		createDomain(team.id, { name: 'prod.example.com' });
		createTemplate(team.id, { name: 'Local only' });

		const other = createTeam();
		createTemplate(other.id, { name: 'Pack template', subject: 'From pack' });

		const zip = await exportDbParts({ parts: ['templates'], teamId: other.id });

		const beforeSes = db.select().from(sesSettings).all();
		const beforeDomains = db.select().from(domains).all();

		await importDbParts({ parts: ['templates'], teamId: team.id, zipBytes: zip });

		expect(db.select().from(sesSettings).all()).toEqual(beforeSes);
		expect(db.select().from(domains).all()).toEqual(beforeDomains);
		const teamTemplates = db.select().from(templates).where(eq(templates.teamId, team.id)).all();
		expect(teamTemplates).toHaveLength(1);
		expect(teamTemplates[0]?.name).toBe('Pack template');
	});

	it('sets domainId null when name is missing on target', async () => {
		const source = createTeam();
		const target = createTeam();
		const domain = createDomain(source.id, { name: 'only-local.dev' });
		createTemplate(source.id, { domainId: domain.id, name: 'T' });

		const zip = await exportDbParts({ parts: ['templates'], teamId: source.id });
		db.delete(templates).where(eq(templates.teamId, source.id)).run();
		db.delete(domains).where(eq(domains.id, domain.id)).run();

		await importDbParts({ parts: ['templates'], teamId: target.id, zipBytes: zip });

		const row = db.select().from(templates).where(eq(templates.teamId, target.id)).get();
		expect(row?.domainId).toBeNull();
	});

	it('skips parts missing from the pack with a warning', async () => {
		const team = createTeam();
		createTemplate(team.id, { name: 'A' });
		const zip = await exportDbParts({ parts: ['templates'], teamId: team.id });

		const summary = await importDbParts({
			parts: ['templates', 'ses'],
			teamId: team.id,
			zipBytes: zip,
		});
		expect(summary.skipped).toContain('ses');
		expect(summary.warnings.some((w) => w.includes('ses'))).toBe(true);
	});
});
