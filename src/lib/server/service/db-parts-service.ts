import { eq, inArray } from 'drizzle-orm';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { db, rawDb } from '../db';
import {
	designAssets,
	designComponents,
	designSystems,
	domains,
	sesSettings,
	templateComponents,
	templateElements,
	templates,
	type DesignAssetKind
} from '../db/schema';
import { createZip, readZip } from './parts-zip';

const DESIGN_ROOT = resolve(process.cwd(), 'data', 'design');

/** Same layout as design-system-service.assetDiskPath — kept local so CLI can import without $lib. */
function assetDiskPath(teamId: number, kind: DesignAssetKind, assetId: string, filename: string) {
	const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
	return join(DESIGN_ROOT, String(teamId), kind, `${assetId}-${safeName}`);
}

export const DB_PART_IDS = ['ses', 'domains', 'templates', 'design'] as const;
export type DbPartId = (typeof DB_PART_IDS)[number];

export type DbPartScope = 'global' | 'team';

export type DbPartDef = {
	id: DbPartId;
	label: string;
	scope: DbPartScope;
	tables: string[];
	needsAssets?: boolean;
};

/** Registry of selectable DB slices for import/export. */
export const DB_PARTS: readonly DbPartDef[] = [
	{
		id: 'ses',
		label: 'SES settings',
		scope: 'global',
		tables: ['ses_settings']
	},
	{
		id: 'domains',
		label: 'Domains',
		scope: 'team',
		tables: ['domains']
	},
	{
		id: 'templates',
		label: 'Templates',
		scope: 'team',
		tables: ['templates', 'template_elements', 'template_components']
	},
	{
		id: 'design',
		label: 'Design system',
		scope: 'team',
		tables: ['design_systems', 'design_assets', 'design_components'],
		needsAssets: true
	}
] as const;

const PART_BY_ID = Object.fromEntries(DB_PARTS.map((p) => [p.id, p])) as Record<DbPartId, DbPartDef>;

export const PARTS_PACK_VERSION = 1;

export type PartsManifest = {
	version: number;
	exportedAt: string;
	sourceTeamId?: number;
	parts: DbPartId[];
	domainMap: Record<string, string>;
};

export type ImportSummary = {
	imported: Partial<Record<DbPartId, Record<string, number>>>;
	skipped: string[];
	warnings: string[];
};

function isDbPartId(value: string): value is DbPartId {
	return (DB_PART_IDS as readonly string[]).includes(value);
}

export function parsePartsList(raw: string | string[] | null | undefined): DbPartId[] {
	const tokens = Array.isArray(raw)
		? raw
		: String(raw ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
	const seen = new Set<DbPartId>();
	const out: DbPartId[] = [];
	for (const t of tokens) {
		if (!isDbPartId(t)) continue;
		if (seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}

export function partsNeedTeam(parts: DbPartId[]): boolean {
	return parts.some((id) => PART_BY_ID[id].scope === 'team');
}

function assertTeamId(teamId: number | undefined): asserts teamId is number {
	if (teamId === undefined || !Number.isInteger(teamId) || teamId <= 0) {
		throw new Error('teamId is required for team-scoped parts');
	}
}

function utf8(data: unknown): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(data, null, 2));
}

function buildDomainMap(teamId?: number): Record<string, string> {
	const rows =
		teamId !== undefined
			? db.select({ id: domains.id, name: domains.name }).from(domains).where(eq(domains.teamId, teamId)).all()
			: db.select({ id: domains.id, name: domains.name }).from(domains).all();
	const map: Record<string, string> = {};
	for (const r of rows) map[String(r.id)] = r.name;
	return map;
}

function parseJsonArray(buf: Buffer | undefined, label: string): Record<string, unknown>[] {
	if (!buf) return [];
	const parsed = JSON.parse(buf.toString('utf8')) as unknown;
	if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);
	return parsed as Record<string, unknown>[];
}

function remapDomainId(
	sourceId: unknown,
	domainMap: Record<string, string>,
	nameToId: Map<string, number>
): number | null {
	if (sourceId === null || sourceId === undefined) return null;
	const name = domainMap[String(sourceId)];
	if (!name) return null;
	return nameToId.get(name) ?? null;
}

function findAssetBytes(files: Map<string, Buffer>, assetId: string, filename: string): Buffer | undefined {
	const exact = files.get(`assets/${assetId}/${filename}`);
	if (exact) return exact;
	for (const [path, data] of files) {
		if (path.startsWith(`assets/${assetId}/`)) return data;
	}
	return undefined;
}

export async function exportDbParts(input: {
	parts: DbPartId[];
	teamId?: number;
}): Promise<Buffer> {
	const parts = input.parts;
	if (parts.length === 0) throw new Error('Select at least one part to export');
	if (partsNeedTeam(parts)) assertTeamId(input.teamId);

	const teamId = input.teamId;
	const entries: { path: string; data: Uint8Array }[] = [];

	const manifest: PartsManifest = {
		version: PARTS_PACK_VERSION,
		exportedAt: new Date().toISOString(),
		sourceTeamId: teamId,
		parts,
		domainMap: buildDomainMap(teamId)
	};
	entries.push({ path: 'manifest.json', data: utf8(manifest) });

	if (parts.includes('ses')) {
		entries.push({ path: 'tables/ses_settings.json', data: utf8(db.select().from(sesSettings).all()) });
	}

	if (parts.includes('domains')) {
		assertTeamId(teamId);
		entries.push({
			path: 'tables/domains.json',
			data: utf8(db.select().from(domains).where(eq(domains.teamId, teamId)).all())
		});
	}

	if (parts.includes('templates')) {
		assertTeamId(teamId);
		const tpl = db.select().from(templates).where(eq(templates.teamId, teamId)).all();
		const tplIds = tpl.map((t) => t.id);
		const elements =
			tplIds.length === 0
				? []
				: db.select().from(templateElements).where(inArray(templateElements.templateId, tplIds)).all();
		const comps =
			tplIds.length === 0
				? []
				: db
						.select()
						.from(templateComponents)
						.where(inArray(templateComponents.templateId, tplIds))
						.all();
		entries.push({ path: 'tables/templates.json', data: utf8(tpl) });
		entries.push({ path: 'tables/template_elements.json', data: utf8(elements) });
		entries.push({ path: 'tables/template_components.json', data: utf8(comps) });
	}

	if (parts.includes('design')) {
		assertTeamId(teamId);
		const systems = db.select().from(designSystems).where(eq(designSystems.teamId, teamId)).all();
		const assets = db.select().from(designAssets).where(eq(designAssets.teamId, teamId)).all();
		const components = db
			.select()
			.from(designComponents)
			.where(eq(designComponents.teamId, teamId))
			.all();
		entries.push({ path: 'tables/design_systems.json', data: utf8(systems) });
		entries.push({ path: 'tables/design_assets.json', data: utf8(assets) });
		entries.push({ path: 'tables/design_components.json', data: utf8(components) });

		for (const asset of assets) {
			const disk = assetDiskPath(teamId, asset.kind as DesignAssetKind, asset.id, asset.filename);
			try {
				const bytes = await readFile(disk);
				entries.push({
					path: `assets/${asset.id}/${asset.filename}`,
					data: new Uint8Array(bytes)
				});
			} catch {
				// Missing on-disk file — row still exported; import will warn.
			}
		}
	}

	return createZip(entries);
}

export async function importDbParts(input: {
	parts: DbPartId[];
	teamId?: number;
	zipBytes: Buffer | Uint8Array;
}): Promise<ImportSummary> {
	const requested = input.parts;
	if (requested.length === 0) throw new Error('Select at least one part to import');
	if (partsNeedTeam(requested)) assertTeamId(input.teamId);

	const files = readZip(Buffer.from(input.zipBytes));
	const manifestBuf = files.get('manifest.json');
	if (!manifestBuf) throw new Error('Invalid pack: missing manifest.json');

	const manifest = JSON.parse(manifestBuf.toString('utf8')) as PartsManifest;
	if (manifest.version !== PARTS_PACK_VERSION) {
		throw new Error(`Unsupported pack version ${manifest.version} (expected ${PARTS_PACK_VERSION})`);
	}

	const warnings: string[] = [];
	const skipped: string[] = [];
	const packParts = new Set(manifest.parts ?? []);

	const toImport: DbPartId[] = [];
	for (const id of requested) {
		if (!packParts.has(id)) {
			skipped.push(id);
			warnings.push(`Part "${id}" is not in this pack — skipped`);
			continue;
		}
		toImport.push(id);
	}
	if (toImport.length === 0) {
		return { imported: {}, skipped, warnings };
	}

	const teamId = input.teamId;
	const domainMap = manifest.domainMap ?? {};
	const imported: ImportSummary['imported'] = {};
	const pendingAssetWrites: { disk: string; bytes: Buffer }[] = [];

	rawDb.transaction(() => {
		if (toImport.includes('ses')) {
			const rows = parseJsonArray(files.get('tables/ses_settings.json'), 'ses_settings');
			rawDb.prepare('DELETE FROM ses_settings').run();
			for (const row of rows) {
				db.insert(sesSettings)
					.values({
						id: String(row.id),
						region: String(row.region),
						idPrefix: String(row.idPrefix),
						topic: String(row.topic),
						topicArn: (row.topicArn as string | null) ?? null,
						transactionalQuota: Number(row.transactionalQuota ?? 50),
						callbackUrl: String(row.callbackUrl),
						callbackSuccess: Boolean(row.callbackSuccess),
						configGeneral: (row.configGeneral as string | null) ?? null,
						configGeneralSuccess: Boolean(row.configGeneralSuccess),
						configClick: (row.configClick as string | null) ?? null,
						configClickSuccess: Boolean(row.configClickSuccess),
						configOpen: (row.configOpen as string | null) ?? null,
						configOpenSuccess: Boolean(row.configOpenSuccess),
						configFull: (row.configFull as string | null) ?? null,
						configFullSuccess: Boolean(row.configFullSuccess),
						sesEmailRateLimit: Number(row.sesEmailRateLimit ?? 1),
						createdAt: row.createdAt ? String(row.createdAt) : undefined,
						updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
					})
					.run();
			}
			imported.ses = { ses_settings: rows.length };
		}

		if (toImport.includes('domains')) {
			assertTeamId(teamId);
			const rows = parseJsonArray(files.get('tables/domains.json'), 'domains');
			for (const row of rows) {
				const name = String(row.name);
				const existing = db.select().from(domains).where(eq(domains.name, name)).get();
				const values = {
					teamId,
					status: (row.status as typeof domains.$inferInsert.status) ?? 'PENDING',
					region: String(row.region ?? 'us-east-1'),
					clickTracking: Boolean(row.clickTracking),
					openTracking: Boolean(row.openTracking),
					publicKey: String(row.publicKey ?? ''),
					dkimSelector: (row.dkimSelector as string | null) ?? 'owlery',
					dkimStatus: (row.dkimStatus as string | null) ?? null,
					spfDetails: (row.spfDetails as string | null) ?? null,
					dmarcAdded: Boolean(row.dmarcAdded),
					errorMessage: (row.errorMessage as string | null) ?? null,
					subdomain: (row.subdomain as string | null) ?? null,
					sesTenantId: (row.sesTenantId as string | null) ?? null,
					isVerifying: Boolean(row.isVerifying),
					updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
				};
				if (existing) {
					db.update(domains).set(values).where(eq(domains.id, existing.id)).run();
				} else {
					db.insert(domains)
						.values({
							name,
							...values,
							createdAt: row.createdAt ? String(row.createdAt) : undefined
						})
						.run();
				}
			}
			imported.domains = { domains: rows.length };
		}

		const nameToId = new Map(
			db
				.select({ id: domains.id, name: domains.name })
				.from(domains)
				.all()
				.map((d) => [d.name, d.id] as const)
		);

		if (toImport.includes('design')) {
			assertTeamId(teamId);
			const systems = parseJsonArray(files.get('tables/design_systems.json'), 'design_systems');
			const assets = parseJsonArray(files.get('tables/design_assets.json'), 'design_assets');
			const components = parseJsonArray(files.get('tables/design_components.json'), 'design_components');

			rawDb
				.prepare(
					`UPDATE template_components SET design_component_id = NULL
           WHERE template_id IN (SELECT id FROM templates WHERE team_id = ?)`
				)
				.run(teamId);
			if (components.length) {
				rawDb
					.prepare(
						`UPDATE template_components SET design_component_id = NULL
             WHERE design_component_id IN (${components.map(() => '?').join(',')})`
					)
					.run(...components.map((r) => String(r.id)));
			}

			const componentIds = components.map((r) => String(r.id));
			const assetIds = assets.map((r) => String(r.id));
			const systemIds = systems.map((r) => String(r.id));

			if (componentIds.length) {
				rawDb
					.prepare(
						`DELETE FROM design_components WHERE team_id = ? OR id IN (${componentIds.map(() => '?').join(',')})`
					)
					.run(teamId, ...componentIds);
			} else {
				rawDb.prepare('DELETE FROM design_components WHERE team_id = ?').run(teamId);
			}
			if (assetIds.length) {
				rawDb
					.prepare(
						`DELETE FROM design_assets WHERE team_id = ? OR id IN (${assetIds.map(() => '?').join(',')})`
					)
					.run(teamId, ...assetIds);
			} else {
				rawDb.prepare('DELETE FROM design_assets WHERE team_id = ?').run(teamId);
			}
			if (systemIds.length) {
				rawDb
					.prepare(
						`DELETE FROM design_systems WHERE team_id = ? OR id IN (${systemIds.map(() => '?').join(',')})`
					)
					.run(teamId, ...systemIds);
			} else {
				rawDb.prepare('DELETE FROM design_systems WHERE team_id = ?').run(teamId);
			}

			for (const row of systems) {
				db.insert(designSystems)
					.values({
						id: String(row.id),
						teamId,
						designMd: (row.designMd as string | null) ?? null,
						createdAt: row.createdAt ? String(row.createdAt) : undefined,
						updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
					})
					.run();
			}

			for (const row of assets) {
				const id = String(row.id);
				const kind = String(row.kind) as DesignAssetKind;
				const filename = String(row.filename);
				const bytes = findAssetBytes(files, id, filename);
				if (bytes) {
					pendingAssetWrites.push({
						disk: assetDiskPath(teamId, kind, id, filename),
						bytes
					});
				} else {
					warnings.push(`Missing asset file for ${id}/${filename}`);
				}
				db.insert(designAssets)
					.values({
						id,
						teamId,
						kind,
						name: String(row.name),
						filename,
						mime: String(row.mime),
						size: Number(row.size ?? 0),
						createdAt: row.createdAt ? String(row.createdAt) : undefined,
						updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
					})
					.run();
			}

			for (const row of components) {
				db.insert(designComponents)
					.values({
						id: String(row.id),
						teamId,
						name: String(row.name),
						kind: (row.kind as typeof designComponents.$inferInsert.kind) ?? 'custom',
						role: String(row.role ?? 'section'),
						description: (row.description as string | null) ?? null,
						props: String(row.props ?? '[]'),
						starterKey: (row.starterKey as string | null) ?? null,
						html: String(row.html ?? ''),
						document: String(row.document ?? ''),
						slots: String(row.slots ?? '[]'),
						createdAt: row.createdAt ? String(row.createdAt) : undefined,
						updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
					})
					.run();
			}

			imported.design = {
				design_systems: systems.length,
				design_assets: assets.length,
				design_components: components.length
			};
		}

		if (toImport.includes('templates')) {
			assertTeamId(teamId);
			const tpl = parseJsonArray(files.get('tables/templates.json'), 'templates');
			const elements = parseJsonArray(files.get('tables/template_elements.json'), 'template_elements');
			const comps = parseJsonArray(
				files.get('tables/template_components.json'),
				'template_components'
			);

			const tplIds = tpl.map((r) => String(r.id));
			if (tplIds.length) {
				rawDb
					.prepare(
						`DELETE FROM templates WHERE team_id = ? OR id IN (${tplIds.map(() => '?').join(',')})`
					)
					.run(teamId, ...tplIds);
			} else {
				rawDb.prepare('DELETE FROM templates WHERE team_id = ?').run(teamId);
			}

			const knownComponents = new Set(
				db
					.select({ id: designComponents.id })
					.from(designComponents)
					.where(eq(designComponents.teamId, teamId))
					.all()
					.map((r) => r.id)
			);

			for (const row of tpl) {
				db.insert(templates)
					.values({
						id: String(row.id),
						name: String(row.name),
						teamId,
						domainId: remapDomainId(row.domainId, domainMap, nameToId),
						subject: String(row.subject),
						html: (row.html as string | null) ?? null,
						content: (row.content as string | null) ?? null,
						prompt: (row.prompt as string | null) ?? null,
						designSnapshot: (row.designSnapshot as string | null) ?? null,
						tags: String(row.tags ?? '[]'),
						createdAt: row.createdAt ? String(row.createdAt) : undefined,
						updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
					})
					.run();
			}

			for (const row of elements) {
				db.insert(templateElements)
					.values({
						id: String(row.id),
						templateId: String(row.templateId),
						type: row.type as typeof templateElements.$inferInsert.type,
						label: String(row.label),
						required: Boolean(row.required ?? true),
						config: String(row.config ?? '{}'),
						order: Number(row.order ?? 0),
						createdAt: row.createdAt ? String(row.createdAt) : undefined,
						updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
					})
					.run();
			}

			for (const row of comps) {
				const designComponentId =
					row.designComponentId && knownComponents.has(String(row.designComponentId))
						? String(row.designComponentId)
						: null;
				if (row.designComponentId && !designComponentId) {
					warnings.push(
						`template_component ${row.id}: design_component_id not found on target — set null`
					);
				}
				db.insert(templateComponents)
					.values({
						id: String(row.id),
						templateId: String(row.templateId),
						name: String(row.name),
						kind: (row.kind as typeof templateComponents.$inferInsert.kind) ?? 'component',
						sourceType:
							(row.sourceType as typeof templateComponents.$inferInsert.sourceType) ?? 'custom',
						designComponentId,
						locked: Boolean(row.locked),
						source: String(row.source ?? ''),
						order: Number(row.order ?? 0),
						createdAt: row.createdAt ? String(row.createdAt) : undefined,
						updatedAt: row.updatedAt ? String(row.updatedAt) : undefined
					})
					.run();
			}

			imported.templates = {
				templates: tpl.length,
				template_elements: elements.length,
				template_components: comps.length
			};
		}
	})();

	for (const { disk, bytes } of pendingAssetWrites) {
		await mkdir(dirname(disk), { recursive: true });
		await writeFile(disk, bytes);
	}

	return { imported, skipped, warnings };
}
