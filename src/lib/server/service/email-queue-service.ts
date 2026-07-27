import { eq } from 'drizzle-orm';
import { cuid, nowIso, parseJsonArray, parseJsonObject } from '$lib/utils';
import { db } from '../db';
import { emails, emailEvents, domains } from '../db/schema';

type Domain = typeof domains.$inferSelect;
import { enqueue } from '../queue';
import { transactionalQueueName, marketingQueueName } from '../queue/constants';
import { sendRawEmail } from '../aws/ses';
import { env } from '../env';
import { getSetting, type SesSetting } from './ses-settings-service';
import { checkEmailLimit } from './limit-service';

export type QueueEmailPayload = {
	emailId: string;
	teamId: number;
	timestamp: number;
	unsubUrl?: string;
	isBulk?: boolean;
};

export type QueueBulkJob = {
	emailId: string;
	teamId: number;
	region: string;
	transactional: boolean;
	unsubUrl?: string;
	delayMs?: number;
	timestamp?: number;
};

type Attachment = { filename: string; content: string };

function parseAttachments(value: string | null | undefined): Attachment[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
	} catch {
		return [];
	}
}

function stripHtml(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, '')
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Resolve the SES configuration set for a domain based on its open/click
 * tracking preferences.
 */
export function getConfigurationSetName(
	domain: Domain | null,
	setting: SesSetting
): string | null {
	const clickTracking = domain?.clickTracking ?? false;
	const openTracking = domain?.openTracking ?? false;

	if (clickTracking && openTracking) {
		return setting.configFull;
	}
	if (clickTracking) {
		return setting.configClick;
	}
	if (openTracking) {
		return setting.configOpen;
	}
	return setting.configGeneral;
}

/**
 * Queue a single email for delivery. Transactional and marketing emails are
 * routed to separate per-region queues.
 */
export function queueEmail(
	emailId: string,
	teamId: number,
	region: string,
	transactional: boolean,
	unsubUrl?: string,
	delayMs?: number
): string {
	const queue = transactional ? transactionalQueueName(region) : marketingQueueName(region);
	const payload: QueueEmailPayload = {
		emailId,
		teamId,
		timestamp: Date.now(),
		unsubUrl,
		isBulk: !transactional
	};

	return enqueue(queue, payload, { jobId: emailId, delayMs });
}

/**
 * Queue multiple email jobs. Jobs keep their own region/transactional routing.
 */
export function queueBulk(jobs: QueueBulkJob[]): void {
	for (const job of jobs) {
		const queue = job.transactional
			? transactionalQueueName(job.region)
			: marketingQueueName(job.region);
		const payload: QueueEmailPayload = {
			emailId: job.emailId,
			teamId: job.teamId,
			timestamp: job.timestamp ?? Date.now(),
			unsubUrl: job.unsubUrl,
			isBulk: !job.transactional
		};
		enqueue(queue, payload, { jobId: job.emailId, delayMs: job.delayMs });
	}
}

function markFailed(emailId: string, teamId: number, error: string): void {
	db.insert(emailEvents)
		.values({
			id: cuid(),
			emailId,
			status: 'FAILED',
			data: JSON.stringify({ error }),
			teamId
		})
		.run();
	db.update(emails).set({ latestStatus: 'FAILED', updatedAt: nowIso() }).where(eq(emails.id, emailId)).run();
}

/**
 * Queue handler: load the email, resolve its SES configuration, enforce the
 * daily limit and dispatch it through SES.
 */
export async function executeEmail(payload: unknown): Promise<void> {
	const { emailId, unsubUrl, isBulk } = (payload ?? {}) as QueueEmailPayload;
	if (!emailId) return;

	const email = db.select().from(emails).where(eq(emails.id, emailId)).get();
	if (!email) {
		return;
	}

	const domain = email.domainId
		? (db.select().from(domains).where(eq(domains.id, email.domainId)).get() ?? null)
		: null;

	const region = domain?.region ?? env.AWS_DEFAULT_REGION;

	const setting = getSetting(region);
	if (!setting) {
		markFailed(email.id, email.teamId, `No SES setting found for region: ${region}`);
		return;
	}

	const configurationSetName = getConfigurationSetName(domain, setting);
	if (!configurationSetName) {
		markFailed(email.id, email.teamId, 'No configuration set found');
		return;
	}

	const limitCheck = await checkEmailLimit(email.teamId);
	if (limitCheck.isLimitReached) {
		db.insert(emailEvents)
			.values({
				id: cuid(),
				emailId: email.id,
				status: 'FAILED',
				data: JSON.stringify({
					error: 'Email sending limit reached',
					reason: limitCheck.reason,
					limit: limitCheck.limit
				}),
				teamId: email.teamId
			})
			.run();
		db.update(emails)
			.set({ latestStatus: 'FAILED', updatedAt: nowIso() })
			.where(eq(emails.id, email.id))
			.run();
		return;
	}

	const text = email.text
		? email.text
		: email.campaignId && email.html
			? stripHtml(email.html)
			: undefined;

	let inReplyToMessageId: string | undefined;
	if (email.inReplyToId) {
		const replyEmail = db.select().from(emails).where(eq(emails.id, email.inReplyToId)).get();
		if (replyEmail?.sesEmailId) {
			inReplyToMessageId = replyEmail.sesEmailId;
		}
	}

	const attachments = parseAttachments(email.attachments);
	const headers = email.headers
		? parseJsonObject<Record<string, string>>(email.headers)
		: undefined;

	try {
		const messageId = await sendRawEmail({
			to: parseJsonArray(email.to),
			from: email.from,
			subject: email.subject,
			replyTo: parseJsonArray(email.replyTo),
			cc: parseJsonArray(email.cc),
			bcc: parseJsonArray(email.bcc),
			text,
			html: email.html ?? undefined,
			region,
			configurationSetName,
			attachments: attachments.length > 0 ? attachments : undefined,
			unsubUrl,
			isBulk,
			inReplyToMessageId,
			emailId: email.id,
			sesTenantId: domain?.sesTenantId ?? undefined,
			headers
		});

		db.update(emails)
			.set({
				sesEmailId: messageId ?? null,
				latestStatus: 'SENT',
				text: text ?? email.text,
				attachments: null,
				headers: null,
				updatedAt: nowIso()
			})
			.where(eq(emails.id, email.id))
			.run();
	} catch (error) {
		markFailed(email.id, email.teamId, error instanceof Error ? error.message : String(error));
	}
}
