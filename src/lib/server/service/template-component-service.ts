import { and, asc, eq } from 'drizzle-orm';
import { cuid, nowIso } from '$lib/utils';
import { db } from '../db';
import { templateComponents, type TemplateComponentKind } from '../db/schema';
import { getTemplate } from './template-service';

export type TemplateComponent = typeof templateComponents.$inferSelect;

export function listComponents(
	templateId: string,
	teamId: number,
	domainId?: number
): TemplateComponent[] {
	getTemplate(templateId, teamId, domainId);
	return db
		.select()
		.from(templateComponents)
		.where(eq(templateComponents.templateId, templateId))
		.orderBy(asc(templateComponents.order), asc(templateComponents.createdAt))
		.all();
}

export function listComponentsByTemplateId(templateId: string): TemplateComponent[] {
	return db
		.select()
		.from(templateComponents)
		.where(eq(templateComponents.templateId, templateId))
		.orderBy(asc(templateComponents.order), asc(templateComponents.createdAt))
		.all();
}

export function getRootComponent(templateId: string): TemplateComponent | undefined {
	return db
		.select()
		.from(templateComponents)
		.where(
			and(eq(templateComponents.templateId, templateId), eq(templateComponents.kind, 'root'))
		)
		.get();
}

export function hasTemplateComponents(templateId: string): boolean {
	const row = db
		.select({ id: templateComponents.id })
		.from(templateComponents)
		.where(eq(templateComponents.templateId, templateId))
		.limit(1)
		.get();
	return Boolean(row);
}

export type UpsertComponentInput = {
	id?: string;
	name: string;
	kind: TemplateComponentKind;
	source: string;
	order?: number;
};

export function replaceTemplateComponents(
	templateId: string,
	teamId: number,
	domainId: number | undefined,
	components: UpsertComponentInput[]
): TemplateComponent[] {
	getTemplate(templateId, teamId, domainId);

	db.delete(templateComponents).where(eq(templateComponents.templateId, templateId)).run();

	if (components.length === 0) return [];

	const rows = components.map((c, index) => ({
		id: c.id ?? cuid(),
		templateId,
		name: c.name,
		kind: c.kind,
		source: c.source,
		order: c.order ?? index
	}));

	return db.insert(templateComponents).values(rows).returning().all();
}

export function updateComponentSource(
	componentId: string,
	templateId: string,
	teamId: number,
	domainId: number | undefined,
	source: string
): TemplateComponent {
	getTemplate(templateId, teamId, domainId);
	const existing = db
		.select()
		.from(templateComponents)
		.where(
			and(eq(templateComponents.id, componentId), eq(templateComponents.templateId, templateId))
		)
		.get();
	if (!existing) throw new Error('Component not found');

	return db
		.update(templateComponents)
		.set({ source, updatedAt: nowIso() })
		.where(eq(templateComponents.id, componentId))
		.returning()
		.get();
}

export function getComponent(
	componentId: string,
	templateId: string,
	teamId: number,
	domainId?: number
): TemplateComponent {
	getTemplate(templateId, teamId, domainId);
	const component = db
		.select()
		.from(templateComponents)
		.where(
			and(eq(templateComponents.id, componentId), eq(templateComponents.templateId, templateId))
		)
		.get();
	if (!component) throw new Error('Component not found');
	return component;
}
