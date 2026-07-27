import { and, desc, eq, lt } from 'drizzle-orm';
import { cuid, jsonArray, nowIso, parseJsonArray } from '$lib/utils';
import { db } from '../db';
import { apiKeys, domains, emails, emailEvents, queueJobs, templates } from '../db/schema';
import { transactionalQueueName } from '../queue/constants';
import { renderEmailHtml } from '$lib/email-editor/renderer';
import { validateApiKeyDomainAccess, validateDomainFromEmail } from './domain-service';
import { checkMultipleEmails } from './suppression-service';
import { queueEmail } from './email-queue-service';

export type Email = typeof emails.$inferSelect;

export type SendEmailInput = {
	teamId: number;
	apiKeyId?: number;
	from: string;
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | string[];
	subject: string;
	text?: string;
	html?: string;
	scheduledAt?: string;
	templateId?: string;
	variables?: Record<string, string>;
	attachments?: { filename: string; content: string }[];
	headers?: Record<string, string>;
	inReplyToId?: string;
	campaignId?: string;
	contactId?: string;
};

/**
 * Replace `{{key}}` placeholders in a string with the provided variables.
 */
export function replaceVariables(content: string, variables: Record<string, string>): string {
	return Object.keys(variables).reduce((acc, key) => {
		const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
		return acc.replace(regex, variables[key] ?? '');
	}, content);
}

function toArray(value?: string | string[]): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function toSqliteDate(date: Date): string {
	return date.toISOString().replace('T', ' ').replace('Z', '');
}

function loadEmailForTeam(emailId: string): { email: Email; region: string } {
	const email = db.select().from(emails).where(eq(emails.id, emailId)).get();

	if (!email || !email.domainId) {
		throw new Error('Email not found');
	}

	const domain = db.select().from(domains).where(eq(domains.id, email.domainId)).get();
	if (!domain) {
		throw new Error('Email not found');
	}

	return { email, region: domain.region };
}

/**
 * Create and queue a transactional email. Suppressed TO recipients short
 * circuit into a `SUPPRESSED` record without sending.
 */
export async function sendEmail(input: SendEmailInput): Promise<Email> {
	const { teamId, apiKeyId, from, templateId, variables, inReplyToId, campaignId, contactId } =
		input;

	let subject = input.subject;
	let html = input.html;
	const text = input.text;

	let domain: Awaited<ReturnType<typeof validateDomainFromEmail>>;

	if (apiKeyId) {
		const apiKeyRow = db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get();
		if (!apiKeyRow) {
			throw new Error('Invalid API key');
		}
		const apiKeyDomain = apiKeyRow.domainId
			? (db
					.select({ name: domains.name })
					.from(domains)
					.where(eq(domains.id, apiKeyRow.domainId))
					.get() ?? null)
			: null;
		domain = await validateApiKeyDomainAccess(from, teamId, { ...apiKeyRow, domain: apiKeyDomain });
	} else {
		domain = await validateDomainFromEmail(from, teamId);
	}

	const toEmails = toArray(input.to);
	const ccEmails = toArray(input.cc);
	const bccEmails = toArray(input.bcc);
	const replyToEmails = toArray(input.replyTo);

	const allEmailsToCheck = [...new Set([...toEmails, ...ccEmails, ...bccEmails])];
	const suppressionResults = await checkMultipleEmails(allEmailsToCheck, teamId);

	const filteredTo = toEmails.filter((email) => !suppressionResults[email]);
	const filteredCc = ccEmails.filter((email) => !suppressionResults[email]);
	const filteredBcc = bccEmails.filter((email) => !suppressionResults[email]);

	if (templateId) {
		const template = db.select().from(templates).where(eq(templates.id, templateId)).get();
		if (template) {
			subject = replaceVariables(template.subject ?? '', variables ?? {});
			html = renderEmailHtml(template.content, template.html, variables);
		}
	}

	if (inReplyToId) {
		const replyEmail = db
			.select({ id: emails.id })
			.from(emails)
			.where(and(eq(emails.id, inReplyToId), eq(emails.teamId, teamId)))
			.get();
		if (!replyEmail) {
			throw new Error('"inReplyTo" is invalid');
		}
	}

	if (!text && !html) {
		throw new Error('Either text or html is required');
	}

	// All TO recipients suppressed: record and stop.
	if (filteredTo.length === 0) {
		const suppressed = db
			.insert(emails)
			.values({
				id: cuid(),
				from,
				to: jsonArray(toEmails),
				replyTo: jsonArray(replyToEmails),
				cc: jsonArray(ccEmails),
				bcc: jsonArray(bccEmails),
				subject,
				text: text ?? null,
				html: html ?? null,
				teamId,
				domainId: domain.id,
				apiId: apiKeyId ?? null,
				latestStatus: 'SUPPRESSED',
				inReplyToId: inReplyToId ?? null,
				campaignId: campaignId ?? null,
				contactId: contactId ?? null
			})
			.returning()
			.get();

		db.insert(emailEvents)
			.values({
				id: cuid(),
				emailId: suppressed.id,
				status: 'SUPPRESSED',
				data: JSON.stringify({ error: 'All TO recipients are suppressed. No emails to send.' }),
				teamId
			})
			.run();

		return suppressed;
	}

	const scheduledAtDate = input.scheduledAt ? new Date(input.scheduledAt) : undefined;
	const delayMs = scheduledAtDate ? Math.max(0, scheduledAtDate.getTime() - Date.now()) : undefined;

	const email = db
		.insert(emails)
		.values({
			id: cuid(),
			from,
			to: jsonArray(filteredTo),
			replyTo: jsonArray(replyToEmails),
			cc: jsonArray(filteredCc),
			bcc: jsonArray(filteredBcc),
			subject,
			text: text ?? null,
			html: html ?? null,
			teamId,
			domainId: domain.id,
			apiId: apiKeyId ?? null,
			attachments: input.attachments ? JSON.stringify(input.attachments) : null,
			headers: input.headers ? JSON.stringify(input.headers) : null,
			scheduledAt: scheduledAtDate ? scheduledAtDate.toISOString() : null,
			latestStatus: scheduledAtDate ? 'SCHEDULED' : 'QUEUED',
			inReplyToId: inReplyToId ?? null,
			campaignId: campaignId ?? null,
			contactId: contactId ?? null
		})
		.returning()
		.get();

	try {
		queueEmail(email.id, teamId, domain.region, true, undefined, delayMs);
	} catch (error) {
		db.insert(emailEvents)
			.values({
				id: cuid(),
				emailId: email.id,
				status: 'FAILED',
				data: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
				teamId
			})
			.run();
		db.update(emails)
			.set({ latestStatus: 'FAILED', updatedAt: nowIso() })
			.where(eq(emails.id, email.id))
			.run();
		throw error;
	}

	return email;
}

/**
 * Reschedule a still-scheduled email to a new send time.
 */
export async function updateEmail(
	emailId: string,
	{ scheduledAt }: { scheduledAt?: string }
): Promise<void> {
	const { email, region } = loadEmailForTeam(emailId);

	if (email.latestStatus !== 'SCHEDULED') {
		throw new Error('Email already processed');
	}

	const scheduledAtDate = scheduledAt ? new Date(scheduledAt) : new Date();
	const runAt = toSqliteDate(scheduledAtDate);

	db.update(emails)
		.set({ scheduledAt: scheduledAtDate.toISOString(), updatedAt: nowIso() })
		.where(eq(emails.id, emailId))
		.run();

	db.update(queueJobs)
		.set({ runAt, updatedAt: nowIso() })
		.where(
			and(
				eq(queueJobs.queue, transactionalQueueName(region)),
				eq(queueJobs.jobId, emailId),
				eq(queueJobs.status, 'pending')
			)
		)
		.run();
}

/**
 * Cancel a scheduled email before it is dispatched.
 */
export async function cancelEmail(emailId: string): Promise<void> {
	const { email, region } = loadEmailForTeam(emailId);

	if (email.latestStatus !== 'SCHEDULED') {
		throw new Error('Email already processed');
	}

	db.delete(queueJobs)
		.where(
			and(
				eq(queueJobs.queue, transactionalQueueName(region)),
				eq(queueJobs.jobId, emailId),
				eq(queueJobs.status, 'pending')
			)
		)
		.run();

	db.update(emails)
		.set({ latestStatus: 'CANCELLED', updatedAt: nowIso() })
		.where(eq(emails.id, emailId))
		.run();

	db.insert(emailEvents)
		.values({
			id: cuid(),
			emailId,
			status: 'CANCELLED',
			teamId: email.teamId
		})
		.run();
}

/**
 * Fetch a single email for a team, including its events.
 */
export function getEmail(emailId: string, teamId: number) {
	const email = db
		.select()
		.from(emails)
		.where(and(eq(emails.id, emailId), eq(emails.teamId, teamId)))
		.get();

	if (!email) {
		throw new Error('Email not found');
	}

	const events = db
		.select()
		.from(emailEvents)
		.where(eq(emailEvents.emailId, emailId))
		.orderBy(desc(emailEvents.createdAt))
		.all();

	return {
		...email,
		to: parseJsonArray(email.to),
		cc: parseJsonArray(email.cc),
		bcc: parseJsonArray(email.bcc),
		replyTo: parseJsonArray(email.replyTo),
		emailEvents: events
	};
}

export type ListEmailsParams = {
	teamId: number;
	limit?: number;
	cursor?: string;
};

/**
 * List emails for a team using id-based cursor pagination.
 */
export function listEmails(params: ListEmailsParams): {
	items: Email[];
	nextCursor: string | null;
} {
	const limit = params.limit ?? 30;

	const conditions = [eq(emails.teamId, params.teamId)];
	if (params.cursor) {
		conditions.push(lt(emails.id, params.cursor));
	}

	const rows = db
		.select()
		.from(emails)
		.where(and(...conditions))
		.orderBy(desc(emails.createdAt))
		.limit(limit + 1)
		.all();

	let nextCursor: string | null = null;
	if (rows.length > limit) {
		const next = rows.pop();
		nextCursor = next?.id ?? null;
	}

	return { items: rows, nextCursor };
}
