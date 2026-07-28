import { and, desc, eq } from 'drizzle-orm';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { cuid, nowIso } from '$lib/utils';
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
	html: string;
};

export function upsertComponent(teamId: number, input: UpsertComponentInput): DesignComponent {
	if (input.id) {
		const existing = getComponent(input.id, teamId);
		return db
			.update(designComponents)
			.set({
				name: input.name,
				description: input.description ?? null,
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
			description: input.description ?? null,
			html: input.html
		})
		.returning()
		.get();
}

export function deleteComponent(componentId: string, teamId: number): DesignComponent {
	const component = getComponent(componentId, teamId);
	db.delete(designComponents).where(eq(designComponents.id, component.id)).run();
	return component;
}

export function getDesignSystemBundle(teamId: number) {
	return {
		system: getDesignSystem(teamId),
		assets: listAssets(teamId),
		components: listComponents(teamId)
	};
}
