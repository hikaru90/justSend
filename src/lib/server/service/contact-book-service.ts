import { and, desc, eq, like, sql } from 'drizzle-orm';
import { cuid, jsonArray, nowIso, parseJsonArray, parseJsonObject } from '$lib/utils';
import { db } from '../db';
import { campaigns, contactBooks, contacts } from '../db/schema';
import { validateDomainFromEmail } from './domain-service';
import {
	DEFAULT_DOUBLE_OPT_IN_CONTENT,
	DEFAULT_DOUBLE_OPT_IN_SUBJECT,
	hasDoubleOptInUrlPlaceholder,
} from './double-opt-in-service';

export type ContactBook = typeof contactBooks.$inferSelect;

export type ContactBookView = Omit<ContactBook, 'variables' | 'properties'> & {
	variables: string[];
	properties: Record<string, unknown>;
	contactCount: number;
};

function normalizeVariables(variables?: string[]): string[] {
	if (!variables) return [];
	return Array.from(new Set(variables.map((v) => v.trim()).filter((v) => v.length > 0)));
}

function toView(book: ContactBook, contactCount: number): ContactBookView {
	return {
		...book,
		variables: parseJsonArray(book.variables),
		properties: parseJsonObject(book.properties),
		contactCount,
	};
}

export function getContactBooks(
	teamId: number,
	searchOrOptions?: string | { domainId?: number; search?: string },
): ContactBookView[] {
	const options =
		typeof searchOrOptions === 'string' ? { search: searchOrOptions } : (searchOrOptions ?? {});
	const conditions = [eq(contactBooks.teamId, teamId)];
	if (options.domainId !== undefined) {
		conditions.push(eq(contactBooks.domainId, options.domainId));
	}
	if (options.search) {
		conditions.push(like(contactBooks.name, `%${options.search}%`));
	}

	const books = db
		.select()
		.from(contactBooks)
		.where(and(...conditions))
		.orderBy(desc(contactBooks.createdAt))
		.all();

	return books.map((book) => {
		const countRow = db
			.select({ value: sql<number>`count(*)` })
			.from(contacts)
			.where(eq(contacts.contactBookId, book.id))
			.get();
		return toView(book, countRow?.value ?? 0);
	});
}

export function getContactBook(
	contactBookId: string,
	teamId: number,
	domainId?: number,
): ContactBookView {
	const conditions = [eq(contactBooks.id, contactBookId), eq(contactBooks.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(contactBooks.domainId, domainId));
	}

	const book = db
		.select()
		.from(contactBooks)
		.where(and(...conditions))
		.get();

	if (!book) {
		throw new Error('Contact book not found');
	}

	const countRow = db
		.select({ value: sql<number>`count(*)` })
		.from(contacts)
		.where(eq(contacts.contactBookId, book.id))
		.get();

	return toView(book, countRow?.value ?? 0);
}

export function createContactBook(
	teamId: number,
	name: string,
	variables?: string[],
	domainId?: number,
): ContactBook {
	return db
		.insert(contactBooks)
		.values({
			id: cuid(),
			name,
			teamId,
			domainId: domainId ?? null,
			variables: jsonArray(normalizeVariables(variables)),
			properties: '{}',
			doubleOptInEnabled: true,
			doubleOptInSubject: DEFAULT_DOUBLE_OPT_IN_SUBJECT,
			doubleOptInContent: DEFAULT_DOUBLE_OPT_IN_CONTENT,
		})
		.returning()
		.get();
}

export function getContactBookDetails(contactBookId: string) {
	const totalRow = db
		.select({ value: sql<number>`count(*)` })
		.from(contacts)
		.where(eq(contacts.contactBookId, contactBookId))
		.get();

	const unsubscribedRow = db
		.select({ value: sql<number>`count(*)` })
		.from(contacts)
		.where(and(eq(contacts.contactBookId, contactBookId), eq(contacts.subscribed, false)))
		.get();

	const recentCampaigns = db
		.select()
		.from(campaigns)
		.where(and(eq(campaigns.contactBookId, contactBookId), eq(campaigns.status, 'SENT')))
		.orderBy(desc(campaigns.createdAt))
		.limit(2)
		.all();

	return {
		totalContacts: totalRow?.value ?? 0,
		unsubscribedContacts: unsubscribedRow?.value ?? 0,
		campaigns: recentCampaigns,
	};
}

export type UpdateContactBookData = {
	name?: string;
	properties?: Record<string, unknown>;
	emoji?: string;
	variables?: string[];
	doubleOptInEnabled?: boolean;
	doubleOptInFrom?: string | null;
	doubleOptInSubject?: string;
	doubleOptInContent?: string;
};

export async function updateContactBook(
	contactBookId: string,
	teamId: number,
	data: UpdateContactBookData,
): Promise<ContactBook> {
	const book = db
		.select()
		.from(contactBooks)
		.where(and(eq(contactBooks.id, contactBookId), eq(contactBooks.teamId, teamId)))
		.get();

	if (!book) {
		throw new Error('Contact book not found');
	}

	const updateData: Record<string, unknown> = { updatedAt: nowIso() };

	if (data.name !== undefined) updateData.name = data.name;
	if (data.emoji !== undefined) updateData.emoji = data.emoji;
	if (data.properties !== undefined) updateData.properties = JSON.stringify(data.properties);
	if (data.variables !== undefined) {
		updateData.variables = jsonArray(normalizeVariables(data.variables));
	}
	if (data.doubleOptInEnabled !== undefined) {
		updateData.doubleOptInEnabled = data.doubleOptInEnabled;
	}

	if (data.doubleOptInFrom !== undefined) {
		const normalizedFrom = data.doubleOptInFrom?.trim() ?? '';
		if (!normalizedFrom) {
			updateData.doubleOptInFrom = null;
		} else {
			await validateDomainFromEmail(normalizedFrom, teamId);
			updateData.doubleOptInFrom = normalizedFrom;
		}
	}

	if (data.doubleOptInContent !== undefined) {
		if (!data.doubleOptInContent.trim()) {
			updateData.doubleOptInContent = DEFAULT_DOUBLE_OPT_IN_CONTENT;
		} else if (!hasDoubleOptInUrlPlaceholder(data.doubleOptInContent)) {
			throw new Error(
				'Double opt-in email content must include the {{doubleOptInUrl}} placeholder',
			);
		} else {
			updateData.doubleOptInContent = data.doubleOptInContent;
		}
	}

	if (data.doubleOptInSubject !== undefined) {
		updateData.doubleOptInSubject = data.doubleOptInSubject.trim()
			? data.doubleOptInSubject
			: DEFAULT_DOUBLE_OPT_IN_SUBJECT;
	}

	return db
		.update(contactBooks)
		.set(updateData)
		.where(eq(contactBooks.id, contactBookId))
		.returning()
		.get();
}

export function deleteContactBook(contactBookId: string, teamId: number): ContactBook {
	const book = db
		.select()
		.from(contactBooks)
		.where(and(eq(contactBooks.id, contactBookId), eq(contactBooks.teamId, teamId)))
		.get();

	if (!book) {
		throw new Error('Contact book not found');
	}

	db.delete(contactBooks).where(eq(contactBooks.id, contactBookId)).run();
	return book;
}
