import { and, desc, eq } from 'drizzle-orm';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ComponentSlot, TEditorConfiguration } from '$lib/email-builder/types';
import { EMPTY_DOCUMENT } from '$lib/email-builder/types';
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
	if (!asset) throw new Error('Asset not found');
	return asset;
}

/** Lookup by id only — used for public email-client image fetches. */
export function getAssetById(assetId: string): DesignAsset {
	const asset = db.select().from(designAssets).where(eq(designAssets.id, assetId)).get();
	if (!asset) throw new Error('Asset not found');
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
	if (!component) throw new Error('Component not found');
	return component;
}

export type UpsertComponentInput = {
	id?: string;
	name: string;
	description?: string | null;
	role?: string | null;
	kind?: 'starter' | 'custom';
	/** Legacy HTML; kept for preview fallback / migration. */
	html?: string;
	/** Email-builder block tree JSON string or object. */
	document?: string | TEditorConfiguration;
	slots?: ComponentSlot[];
};

const SLOT_TYPES = new Set(['text', 'url', 'asset', 'color']);

export function normalizeSlots(slots?: ComponentSlot[]): ComponentSlot[] {
	if (!slots?.length) return [];
	const out: ComponentSlot[] = [];
	const seen = new Set<string>();
	for (const slot of slots) {
		const name = String(slot.name ?? '')
			.trim()
			.replace(/\s+/g, '_');
		const blockId = String(slot.blockId ?? '').trim();
		const prop = String(slot.prop ?? '').trim();
		const type = SLOT_TYPES.has(slot.type) ? slot.type : 'text';
		if (!name || !blockId || !prop || seen.has(name)) continue;
		seen.add(name);
		out.push({
			name,
			blockId,
			prop,
			type,
			...(slot.label?.trim() ? { label: slot.label.trim() } : {})
		});
	}
	return out;
}

export function serializeSlots(slots?: ComponentSlot[]): string {
	return JSON.stringify(normalizeSlots(slots));
}

export function parseComponentSlots(
	component: Pick<DesignComponent, 'props'> & { slots?: string | null }
): ComponentSlot[] {
	try {
		const parsed = JSON.parse(component.slots || '[]');
		if (Array.isArray(parsed) && parsed.length > 0) {
			return normalizeSlots(parsed as ComponentSlot[]);
		}
	} catch {
		/* fall through to legacy props */
	}
	// Legacy: props was a string[] of slot names without block pointers.
	try {
		const legacy = JSON.parse(component.props || '[]');
		if (Array.isArray(legacy)) {
			return normalizeSlots(
				legacy.map((name) => ({
					name: String(name),
					blockId: '',
					prop: 'props.text',
					type: 'text' as const
				})).filter((s) => s.name && s.blockId === '')
			);
		}
	} catch {
		/* ignore */
	}
	return [];
}

/** Slot names only (for AI prompts / expected-slot lists). */
export function parseComponentProps(
	component: Pick<DesignComponent, 'props'> & { slots?: string | null }
): string[] {
	const slots = parseComponentSlots(component);
	if (slots.length > 0) return slots.map((s) => s.name);
	try {
		const parsed = JSON.parse(component.props || '[]');
		if (!Array.isArray(parsed)) return [];
		return [...new Set(parsed.map(String).map((v) => v.trim()).filter(Boolean))];
	} catch {
		return [];
	}
}

export function parseComponentDocument(
	component: Pick<DesignComponent, 'document'>
): TEditorConfiguration | null {
	const raw = component.document?.trim();
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		const doc = parsed as TEditorConfiguration;
		if (!doc.root || doc.root.type !== 'EmailLayout') return null;
		return doc;
	} catch {
		return null;
	}
}

function serializeDocument(document?: string | TEditorConfiguration): string {
	if (document == null) return '';
	if (typeof document === 'string') return document;
	return JSON.stringify(document);
}

export function upsertComponent(teamId: number, input: UpsertComponentInput): DesignComponent {
	const documentJson = serializeDocument(input.document);
	const slotsJson = input.slots !== undefined ? serializeSlots(input.slots) : undefined;

	if (input.id) {
		const existing = getComponent(input.id, teamId);
		return db
			.update(designComponents)
			.set({
				name: input.name,
				kind: 'custom',
				role: input.role?.trim() || existing.role,
				description: input.description ?? null,
				props: JSON.stringify(parseComponentProps({
					slots: slotsJson ?? existing.slots,
					props: existing.props
				})),
				html: input.html ?? existing.html,
				document: documentJson || existing.document,
				slots: slotsJson ?? existing.slots,
				updatedAt: nowIso()
			})
			.where(eq(designComponents.id, existing.id))
			.returning()
			.get();
	}

	const slots = normalizeSlots(input.slots);
	return db
		.insert(designComponents)
		.values({
			id: cuid(),
			teamId,
			name: input.name,
			kind: 'custom',
			role: input.role?.trim() || 'section',
			description: input.description ?? null,
			props: JSON.stringify(slots.map((s) => s.name)),
			starterKey: null,
			html: input.html ?? '',
			document: documentJson || JSON.stringify(EMPTY_DOCUMENT),
			slots: serializeSlots(slots)
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
