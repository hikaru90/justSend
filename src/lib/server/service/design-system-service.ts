import { and, desc, eq } from 'drizzle-orm';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { cuid, nowIso } from '$lib/utils';
import { STARTER_DESIGN_COMPONENTS } from './design-component-library';
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

export function upsertComponent(teamId: number, input: UpsertComponentInput): DesignComponent {
	if (input.id) {
		const existing = getComponent(input.id, teamId);
		return db
			.update(designComponents)
			.set({
				name: input.name,
				kind: 'custom',
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
			kind: 'custom',
			role: input.role?.trim() || 'section',
			description: input.description ?? null,
			props: serializeProps(input.props),
			starterKey: input.starterKey ?? null,
			html: input.html
		})
		.returning()
		.get();
}

/**
 * Deterministically append kit sections that aren't already present
 * (matched by starterKey). Never updates or overwrites existing rows.
 */
export function appendStarterComponents(teamId: number): { added: number; skipped: number } {
	const existingKeys = new Set(
		listComponents(teamId)
			.map((component) => component.starterKey)
			.filter((key): key is string => Boolean(key))
	);

	let added = 0;
	let skipped = 0;
	for (const starter of STARTER_DESIGN_COMPONENTS) {
		if (existingKeys.has(starter.starterKey)) {
			skipped += 1;
			continue;
		}
		db.insert(designComponents)
			.values({
				id: cuid(),
				teamId,
				name: starter.name,
				kind: 'custom',
				role: starter.role,
				description: starter.description,
				props: serializeProps(starter.props),
				starterKey: starter.starterKey,
				html: starter.html
			})
			.run();
		existingKeys.add(starter.starterKey);
		added += 1;
	}

	return { added, skipped };
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
