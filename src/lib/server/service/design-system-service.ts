import { and, desc, eq } from 'drizzle-orm';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { cuid, nowIso } from '$lib/utils';
import {
	STARTER_DESIGN_COMPONENTS,
	getStarterDesignComponentByKey
} from './design-component-library';
import { db } from '../db';
import {
	designAssets,
	designComponents,
	designSystems,
	type DesignAssetKind
} from '../db/schema';

export type DesignSystem = typeof designSystems.$inferSelect;
export type DesignAsset = typeof designAssets.$inferSelect;
export type DesignComponent = typeof designComponents.$inferSelect;

const DESIGN_ROOT = resolve(process.cwd(), 'data', 'design');

export function assetDiskPath(teamId: number, kind: DesignAssetKind, assetId: string, filename: string) {
	const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
	return join(DESIGN_ROOT, String(teamId), kind, `${assetId}-${safeName}`);
}

export function getDesignSystem(teamId: number): DesignSystem | null {
	return db.select().from(designSystems).where(eq(designSystems.teamId, teamId)).get() ?? null;
}

export function upsertDesignMd(teamId: number, designMd: string): DesignSystem {
	const existing = getDesignSystem(teamId);
	if (existing) {
		return db
			.update(designSystems)
			.set({ designMd, updatedAt: nowIso() })
			.where(eq(designSystems.id, existing.id))
			.returning()
			.get();
	}

	return db
		.insert(designSystems)
		.values({
			id: cuid(),
			teamId,
			designMd
		})
		.returning()
		.get();
}

export function listAssets(teamId: number): DesignAsset[] {
	return db
		.select()
		.from(designAssets)
		.where(eq(designAssets.teamId, teamId))
		.orderBy(desc(designAssets.createdAt))
		.all();
}

export function getAsset(assetId: string, teamId: number): DesignAsset {
	const asset = db
		.select()
		.from(designAssets)
		.where(and(eq(designAssets.id, assetId), eq(designAssets.teamId, teamId)))
		.get();

	if (!asset) {
		throw new Error('Asset not found');
	}

	return asset;
}

export async function addAsset(
	teamId: number,
	input: {
		kind: DesignAssetKind;
		name: string;
		filename: string;
		mime: string;
		bytes: Uint8Array;
	}
): Promise<DesignAsset> {
	const id = cuid();
	const path = assetDiskPath(teamId, input.kind, id, input.filename);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, input.bytes);

	return db
		.insert(designAssets)
		.values({
			id,
			teamId,
			kind: input.kind,
			name: input.name,
			filename: input.filename,
			mime: input.mime,
			size: input.bytes.byteLength
		})
		.returning()
		.get();
}

export async function updateAsset(
	assetId: string,
	teamId: number,
	input: {
		name: string;
		file?: {
			filename: string;
			mime: string;
			bytes: Uint8Array;
		};
	}
): Promise<DesignAsset> {
	const asset = getAsset(assetId, teamId);
	const name = input.name.trim();
	if (!name) {
		throw new Error('Name is required');
	}

	const patch: {
		name: string;
		updatedAt: string;
		filename?: string;
		mime?: string;
		size?: number;
	} = {
		name,
		updatedAt: nowIso()
	};

	if (input.file) {
		const oldPath = assetDiskPath(teamId, asset.kind, asset.id, asset.filename);
		const newPath = assetDiskPath(teamId, asset.kind, asset.id, input.file.filename);
		await mkdir(dirname(newPath), { recursive: true });
		await writeFile(newPath, input.file.bytes);
		if (oldPath !== newPath) {
			try {
				await unlink(oldPath);
			} catch {
				// Old file may already be missing.
			}
		}
		patch.filename = input.file.filename;
		patch.mime = input.file.mime;
		patch.size = input.file.bytes.byteLength;
	}

	return db
		.update(designAssets)
		.set(patch)
		.where(and(eq(designAssets.id, asset.id), eq(designAssets.teamId, teamId)))
		.returning()
		.get();
}

export async function deleteAsset(assetId: string, teamId: number): Promise<DesignAsset> {
	const asset = getAsset(assetId, teamId);
	const path = assetDiskPath(teamId, asset.kind, asset.id, asset.filename);
	try {
		await unlink(path);
	} catch {
		// File may already be missing; still remove the DB row.
	}
	db.delete(designAssets).where(eq(designAssets.id, asset.id)).run();
	return asset;
}

export function listComponents(teamId: number): DesignComponent[] {
	ensureStarterComponents(teamId);
	return db
		.select()
		.from(designComponents)
		.where(eq(designComponents.teamId, teamId))
		.orderBy(desc(designComponents.createdAt))
		.all();
}

export function getComponent(componentId: string, teamId: number): DesignComponent {
	const component = db
		.select()
		.from(designComponents)
		.where(and(eq(designComponents.id, componentId), eq(designComponents.teamId, teamId)))
		.get();

	if (!component) {
		throw new Error('Component not found');
	}

	return component;
}

export type UpsertComponentInput = {
	id?: string;
	name: string;
	description?: string | null;
	role?: string | null;
	props?: string[];
	starterKey?: string | null;
	kind?: 'starter' | 'custom';
	html: string;
};

function normalizeProps(props?: string[]): string[] {
	return [...new Set((props ?? []).map((value) => value.trim()).filter(Boolean))];
}

function serializeProps(props?: string[]): string {
	return JSON.stringify(normalizeProps(props));
}

export function parseComponentProps(component: Pick<DesignComponent, 'props'>): string[] {
	try {
		const parsed = JSON.parse(component.props);
		if (!Array.isArray(parsed)) return [];
		return normalizeProps(parsed.map(String));
	} catch {
		return [];
	}
}

export function ensureStarterComponents(teamId: number): DesignComponent[] {
	const existing = db
		.select()
		.from(designComponents)
		.where(eq(designComponents.teamId, teamId))
		.all();

	const byStarterKey = new Map(
		existing.filter((component) => component.starterKey).map((component) => [component.starterKey, component])
	);

	for (const starter of STARTER_DESIGN_COMPONENTS) {
		const row = byStarterKey.get(starter.starterKey);
		if (row) {
			const nextSerializedProps = serializeProps(starter.props);
			// Migrate legacy Svelte starter sources to plain HTML with {{slot}} placeholders.
			const looksLikeSvelte =
				/\$props\s*\(/.test(row.html) || /<\/?script\b/i.test(row.html);
			const needsMetaSync =
				row.kind !== 'starter' ||
				row.role !== starter.role ||
				row.starterKey !== starter.starterKey ||
				row.props !== nextSerializedProps;
			if (needsMetaSync || looksLikeSvelte || !row.html.trim()) {
				db.update(designComponents)
					.set({
						kind: 'starter',
						role: starter.role,
						props: nextSerializedProps,
						starterKey: starter.starterKey,
						...(looksLikeSvelte || !row.html.trim() ? { html: starter.html } : {}),
						updatedAt: nowIso()
					})
					.where(eq(designComponents.id, row.id))
					.run();
			}
			continue;
		}

		db.insert(designComponents)
			.values({
				id: cuid(),
				teamId,
				name: starter.name,
				kind: 'starter',
				role: starter.role,
				description: starter.description,
				props: serializeProps(starter.props),
				starterKey: starter.starterKey,
				html: starter.html
			})
			.run();
	}

	return db
		.select()
		.from(designComponents)
		.where(eq(designComponents.teamId, teamId))
		.orderBy(desc(designComponents.createdAt))
		.all();
}

export function upsertComponent(teamId: number, input: UpsertComponentInput): DesignComponent {
	ensureStarterComponents(teamId);
	if (input.id) {
		const existing = getComponent(input.id, teamId);
		return db
			.update(designComponents)
			.set({
				name: input.name,
				kind: input.kind ?? existing.kind,
				role: input.role?.trim() || existing.role,
				description: input.description ?? null,
				props: serializeProps(input.props ?? parseComponentProps(existing)),
				starterKey: input.starterKey ?? existing.starterKey,
				html: input.html,
				updatedAt: nowIso()
			})
			.where(eq(designComponents.id, existing.id))
			.returning()
			.get();
	}

	return db
		.insert(designComponents)
		.values({
			id: cuid(),
			teamId,
			name: input.name,
			kind: input.kind ?? 'custom',
			role: input.role?.trim() || 'section',
			description: input.description ?? null,
			props: serializeProps(input.props),
			starterKey: input.starterKey ?? null,
			html: input.html
		})
		.returning()
		.get();
}

export function deleteComponent(componentId: string, teamId: number): DesignComponent {
	const component = getComponent(componentId, teamId);
	if (component.kind === 'starter' && component.starterKey) {
		const starter = getStarterDesignComponentByKey(component.starterKey);
		if (!starter) return component;
		return db
			.update(designComponents)
			.set({
				name: starter.name,
				role: starter.role,
				description: starter.description,
				props: serializeProps(starter.props),
				html: starter.html,
				updatedAt: nowIso()
			})
			.where(eq(designComponents.id, component.id))
			.returning()
			.get();
	}
	db.delete(designComponents).where(eq(designComponents.id, component.id)).run();
	return component;
}

export function getDesignSystemBundle(teamId: number) {
	ensureStarterComponents(teamId);
	return {
		system: getDesignSystem(teamId),
		assets: listAssets(teamId),
		components: listComponents(teamId)
	};
}
