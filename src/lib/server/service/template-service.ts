import { and, desc, eq } from 'drizzle-orm';
import { cuid, nowIso } from '$lib/utils';
import { db } from '../db';
import { templates } from '../db/schema';

export type Template = typeof templates.$inferSelect;

export function listTemplates(teamId: number): Template[] {
	return db
		.select()
		.from(templates)
		.where(eq(templates.teamId, teamId))
		.orderBy(desc(templates.createdAt))
		.all();
}

export function getTemplate(templateId: string, teamId: number): Template {
	const template = db
		.select()
		.from(templates)
		.where(and(eq(templates.id, templateId), eq(templates.teamId, teamId)))
		.get();

	if (!template) {
		throw new Error('Template not found');
	}

	return template;
}

export type CreateTemplateInput = {
	teamId: number;
	name: string;
	subject: string;
	html?: string | null;
	content?: string | null;
};

export function createTemplate(input: CreateTemplateInput): Template {
	return db
		.insert(templates)
		.values({
			id: cuid(),
			teamId: input.teamId,
			name: input.name,
			subject: input.subject,
			html: input.html ?? null,
			content: input.content ?? null
		})
		.returning()
		.get();
}

export type UpdateTemplateInput = {
	name?: string;
	subject?: string;
	html?: string | null;
	content?: string | null;
};

export function updateTemplate(
	templateId: string,
	teamId: number,
	data: UpdateTemplateInput
): Template {
	const template = getTemplate(templateId, teamId);

	return db
		.update(templates)
		.set({
			...(data.name !== undefined ? { name: data.name } : {}),
			...(data.subject !== undefined ? { subject: data.subject } : {}),
			...(data.html !== undefined ? { html: data.html } : {}),
			...(data.content !== undefined ? { content: data.content } : {}),
			updatedAt: nowIso()
		})
		.where(eq(templates.id, template.id))
		.returning()
		.get();
}

export function deleteTemplate(templateId: string, teamId: number): Template {
	const template = getTemplate(templateId, teamId);
	db.delete(templates).where(eq(templates.id, template.id)).run();
	return template;
}
