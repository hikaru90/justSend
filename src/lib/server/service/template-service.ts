import { and, desc, eq } from 'drizzle-orm';
import { cuid, jsonArray, nowIso, parseJsonArray } from '$lib/utils';
import { db } from '../db';
import { templates } from '../db/schema';

export type Template = typeof templates.$inferSelect;

export type TemplateWithTags = Template & { tagList: string[] };

const TAG_MAX_LENGTH = 40;
const TAG_MAX_COUNT = 20;

export function normalizeTemplateTags(raw: string[] | string | null | undefined): string[] {
	const values = typeof raw === 'string' ? parseJsonArray(raw) : (raw ?? []);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const tag = String(value).trim().toLowerCase().slice(0, TAG_MAX_LENGTH);
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
		if (out.length >= TAG_MAX_COUNT) break;
	}
	return out;
}

export function withTemplateTags(template: Template): TemplateWithTags {
	return { ...template, tagList: normalizeTemplateTags(template.tags) };
}

export function listTemplates(teamId: number, domainId?: number): TemplateWithTags[] {
	const conditions = [eq(templates.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(templates.domainId, domainId));
	}
	return db
		.select()
		.from(templates)
		.where(and(...conditions))
		.orderBy(desc(templates.createdAt))
		.all()
		.map(withTemplateTags);
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
			content: input.content ?? null,
			tags: '[]'
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
	tags?: string[] | string | null;
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
			...(data.tags !== undefined ? { tags: jsonArray(normalizeTemplateTags(data.tags)) } : {}),
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
