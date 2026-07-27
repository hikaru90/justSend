import { and, asc, eq } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from '../db';
import { env } from '../env';
import { contactBooks, contacts, domains } from '../db/schema';
import { renderEmailHtml } from '$lib/email-editor/renderer';
import { sendEmail } from './email-service';
import { validateDomainFromEmail } from './domain-service';

export const DEFAULT_DOUBLE_OPT_IN_SUBJECT = 'Please confirm your subscription';

const DEFAULT_DOUBLE_OPT_IN_CONTENT_JSON = {
	type: 'doc',
	content: [
		{
			type: 'paragraph',
			attrs: { textAlign: 'left' },
			content: [
				{
					type: 'text',
					text: 'Hello, Thank you for signing up. Please confirm that you want to receive emails from us.'
				}
			]
		},
		{
			type: 'button',
			attrs: {
				component: 'button',
				text: 'Confirm',
				url: '{{doubleOptInUrl}}',
				alignment: 'left'
			}
		},
		{ type: 'horizontalRule' },
		{
			type: 'paragraph',
			attrs: { textAlign: 'left' },
			content: [
				{
					type: 'text',
					text: 'You are receiving this email because you opted in via our site.'
				}
			]
		}
	]
};

export const DEFAULT_DOUBLE_OPT_IN_CONTENT = JSON.stringify(DEFAULT_DOUBLE_OPT_IN_CONTENT_JSON);

const DOUBLE_OPT_IN_URL_PLACEHOLDER_REGEX =
	/\{\{\s*doubleOptInUrl(?:\s*,\s*fallback=[^}]+)?\s*\}\}/i;

const DOUBLE_OPT_IN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function valueIncludesDoubleOptInUrl(value: unknown): boolean {
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		return DOUBLE_OPT_IN_URL_PLACEHOLDER_REGEX.test(value) || normalized === 'doubleoptinurl';
	}
	if (Array.isArray(value)) {
		return value.some(valueIncludesDoubleOptInUrl);
	}
	if (value && typeof value === 'object') {
		return Object.values(value).some(valueIncludesDoubleOptInUrl);
	}
	return false;
}

export function hasDoubleOptInUrlPlaceholder(content: string): boolean {
	if (DOUBLE_OPT_IN_URL_PLACEHOLDER_REGEX.test(content)) {
		return true;
	}
	try {
		return valueIncludesDoubleOptInUrl(JSON.parse(content));
	} catch {
		return false;
	}
}

function createDoubleOptInHash(contactId: string, expiresAt: number): string {
	return createHash('sha256')
		.update(`${contactId}-${expiresAt}-${env.AUTH_SECRET}`)
		.digest('hex');
}

function createDoubleOptInConfirmationUrl(contactId: string): string {
	const expiresAt = Date.now() + DOUBLE_OPT_IN_EXPIRY_MS;
	const hash = createDoubleOptInHash(contactId, expiresAt);
	const searchParams = new URLSearchParams({
		contactId,
		expiresAt: String(expiresAt),
		hash
	});
	return `${env.HOST_URL}/subscribe?${searchParams.toString()}`;
}

function replaceTemplateTokens(value: string, variables: Record<string, string>): string {
	return Object.entries(variables).reduce((acc, [key, replacement]) => {
		const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const tokenRegex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'gi');
		return acc.replace(tokenRegex, replacement);
	}, value);
}

/**
 * Render and send a double opt-in confirmation email to a pending contact.
 */
export async function sendDoubleOptInConfirmationEmail({
	contactId,
	contactBookId,
	teamId
}: {
	contactId: string;
	contactBookId: string;
	teamId: number;
}): Promise<void> {
	const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
	if (!contact || contact.contactBookId !== contactBookId) {
		throw new Error('Contact not found for double opt-in email');
	}

	const contactBook = db
		.select()
		.from(contactBooks)
		.where(eq(contactBooks.id, contactBookId))
		.get();
	if (!contactBook || !contactBook.doubleOptInEnabled) {
		return;
	}

	const configuredFrom = contactBook.doubleOptInFrom?.trim();
	let from: string;

	if (!configuredFrom) {
		const domain = db
			.select({ name: domains.name })
			.from(domains)
			.where(and(eq(domains.teamId, teamId), eq(domains.status, 'SUCCESS')))
			.orderBy(asc(domains.createdAt))
			.get();

		if (!domain) {
			throw new Error(
				'Double opt-in requires at least one verified domain to send confirmation emails'
			);
		}
		from = `hello@${domain.name}`;
	} else {
		from = configuredFrom;
	}

	const confirmationUrl = createDoubleOptInConfirmationUrl(contact.id);

	const variableValues: Record<string, string> = {
		email: contact.email,
		firstName: contact.firstName ?? '',
		lastName: contact.lastName ?? '',
		doubleOptInUrl: confirmationUrl
	};

	const content = contactBook.doubleOptInContent ?? DEFAULT_DOUBLE_OPT_IN_CONTENT;

	let html: string;
	try {
		html = renderEmailHtml(content, null, variableValues);
	} catch (error) {
		console.error('[double-opt-in] Failed to render custom template, using fallback', error);
		html = `<p>Please confirm your subscription by clicking <a href="${confirmationUrl}">this link</a>.</p>`;
	}

	const subject = replaceTemplateTokens(
		contactBook.doubleOptInSubject ?? DEFAULT_DOUBLE_OPT_IN_SUBJECT,
		variableValues
	);

	await validateDomainFromEmail(from, teamId);

	await sendEmail({
		teamId,
		to: contact.email,
		from,
		subject,
		html: replaceTemplateTokens(html, { doubleOptInUrl: confirmationUrl })
	});
}

/**
 * Confirm a double opt-in subscription from the emailed link.
 */
export function confirmDoubleOptInSubscription({
	contactId,
	expiresAt,
	hash
}: {
	contactId: string;
	expiresAt: string;
	hash: string;
}) {
	const expiresAtTimestamp = Number(expiresAt);
	if (!Number.isFinite(expiresAtTimestamp)) {
		throw new Error('Invalid confirmation link');
	}
	if (Date.now() > expiresAtTimestamp) {
		throw new Error('Confirmation link has expired');
	}

	const expectedHash = createDoubleOptInHash(contactId, expiresAtTimestamp);
	const providedBuffer = Buffer.from(hash, 'utf-8');
	const expectedBuffer = Buffer.from(expectedHash, 'utf-8');
	if (
		providedBuffer.length !== expectedBuffer.length ||
		!timingSafeEqual(providedBuffer, expectedBuffer)
	) {
		throw new Error('Invalid confirmation link');
	}

	const existing = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
	if (!existing) {
		throw new Error('Contact not found');
	}

	if (existing.subscribed || existing.unsubscribeReason != null) {
		return existing;
	}

	return db
		.update(contacts)
		.set({ subscribed: true, unsubscribeReason: null, updatedAt: new Date().toISOString() })
		.where(eq(contacts.id, contactId))
		.returning()
		.get();
}
