import { and, asc, eq, max } from 'drizzle-orm';
import { cuid, nowIso } from '$lib/utils';
import { db } from '../db';
import { templateElements, type TemplateElementType } from '../db/schema';
import { getTemplate } from './template-service';

export type TemplateElement = typeof templateElements.$inferSelect;

export function listElements(
	templateId: string,
	teamId: number,
	domainId?: number
): TemplateElement[] {
	getTemplate(templateId, teamId, domainId);
	return db
		.select()
		.from(templateElements)
		.where(eq(templateElements.templateId, templateId))
		.orderBy(asc(templateElements.order), asc(templateElements.createdAt))
		.all();
}

export function getElement(
	elementId: string,
	templateId: string,
	teamId: number,
	domainId?: number
): TemplateElement {
	getTemplate(templateId, teamId, domainId);
	const element = db
		.select()
		.from(templateElements)
		.where(and(eq(templateElements.id, elementId), eq(templateElements.templateId, templateId)))
		.get();

	if (!element) {
		throw new Error('Element not found');
	}

	return element;
}

export type CreateElementInput = {
	templateId: string;
	teamId: number;
	domainId?: number;
	type: TemplateElementType;
	label: string;
	required?: boolean;
	config?: string;
};

function nextElementOrder(templateId: string): number {
	const row = db
		.select({ maxOrder: max(templateElements.order) })
		.from(templateElements)
		.where(eq(templateElements.templateId, templateId))
		.get();
	return (row?.maxOrder ?? -1) + 1;
}

export function createElement(input: CreateElementInput): TemplateElement {
	getTemplate(input.templateId, input.teamId, input.domainId);

	return db
		.insert(templateElements)
		.values({
			id: cuid(),
			templateId: input.templateId,
			type: input.type,
			label: input.label,
			required: input.required ?? true,
			config: input.config ?? '{}',
			order: nextElementOrder(input.templateId)
		})
		.returning()
		.get();
}

export function deleteElement(
	elementId: string,
	templateId: string,
	teamId: number,
	domainId?: number
): TemplateElement {
	const element = getElement(elementId, templateId, teamId, domainId);
	db.delete(templateElements).where(eq(templateElements.id, element.id)).run();
	return element;
}

export function updateElement(
	elementId: string,
	templateId: string,
	teamId: number,
	domainId: number | undefined,
	data: { label?: string; required?: boolean; config?: string }
): TemplateElement {
	const element = getElement(elementId, templateId, teamId, domainId);
	return db
		.update(templateElements)
		.set({
			...(data.label !== undefined ? { label: data.label } : {}),
			...(data.required !== undefined ? { required: data.required } : {}),
			...(data.config !== undefined ? { config: data.config } : {}),
			updatedAt: nowIso()
		})
		.where(eq(templateElements.id, element.id))
		.returning()
		.get();
}

export function reorderElements(
	templateId: string,
	teamId: number,
	domainId: number | undefined,
	orderedIds: string[]
): TemplateElement[] {
	getTemplate(templateId, teamId, domainId);
	const existing = listElements(templateId, teamId, domainId);
	const existingIds = new Set(existing.map((el) => el.id));

	if (orderedIds.length !== existing.length || orderedIds.some((id) => !existingIds.has(id))) {
		throw new Error('Invalid element order');
	}

	const updatedAt = nowIso();
	for (const [index, id] of orderedIds.entries()) {
		db.update(templateElements)
			.set({ order: index, updatedAt })
			.where(and(eq(templateElements.id, id), eq(templateElements.templateId, templateId)))
			.run();
	}

	return listElements(templateId, teamId, domainId);
}
