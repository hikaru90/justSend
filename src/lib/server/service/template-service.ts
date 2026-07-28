import { and, desc, eq } from 'drizzle-orm';
import { cuid, nowIso } from '$lib/utils';
import { db } from '../db';
import { templates } from '../db/schema';

export type Template = typeof templates.$inferSelect;

export function listTemplates(teamId: number, domainId?: number): Template[] {
	const conditions = [eq(templates.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(templates.domainId, domainId));
	}
	return db
		.select()
		.from(templates)
		.where(and(...conditions))
		.orderBy(desc(templates.createdAt))
		.all();
}

export function getTemplate(templateId: string, teamId: number, domainId?: number): Template {
	const conditions = [eq(templates.id, templateId), eq(templates.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(templates.domainId, domainId));
	}
	const template = db
		.select()
		.from(templates)
		.where(and(...conditions))
		.get();

	if (!template) {
		throw new Error('Template not found');
	}

	return template;
}

export type CreateTemplateInput = {
	teamId: number;
	domainId?: number | null;
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
			domainId: input.domainId ?? null,
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
	prompt?: string | null;
	designSnapshot?: string | null;
};

export function updateTemplate(
	templateId: string,
	teamId: number,
	data: UpdateTemplateInput,
	domainId?: number
): Template {
	const template = getTemplate(templateId, teamId, domainId);

	return db
		.update(templates)
		.set({
			...(data.name !== undefined ? { name: data.name } : {}),
			...(data.subject !== undefined ? { subject: data.subject } : {}),
			...(data.html !== undefined ? { html: data.html } : {}),
			...(data.content !== undefined ? { content: data.content } : {}),
			...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
			...(data.designSnapshot !== undefined ? { designSnapshot: data.designSnapshot } : {}),
			updatedAt: nowIso()
		})
		.where(eq(templates.id, template.id))
		.returning()
		.get();
}

export function deleteTemplate(templateId: string, teamId: number, domainId?: number): Template {
	const template = getTemplate(templateId, teamId, domainId);
	db.delete(templates).where(eq(templates.id, template.id)).run();
	return template;
}
