import { and, eq, sql } from 'drizzle-orm';
import { cuid } from '$lib/utils';
import { db } from '../db';
import { env } from '../env';
import {
	contacts,
	contactBooks,
	cumulatedMetrics,
	dailyEmailUsages,
	emails,
	emailEvents,
	emailStatuses,
	type EmailStatus
} from '../db/schema';
import { enqueue } from '../queue';
import { QUEUES } from '../queue/constants';
import { addSuppression } from './suppression-service';
import * as webhookService from './webhook-service';
import { unsubscribeContact, updateCampaignAnalytics } from './campaign-service';
import type {
	EmailBasePayload,
	EmailEventPayloadMap,
	EmailWebhookEventType
} from '../webhook-events';

type SesHeader = { name: string; value: string };

type SesRecipient = { emailAddress: string; diagnosticCode?: string };

export type SesEvent = {
	eventType: string;
	mail: {
		messageId: string;
		timestamp?: string;
		headers?: SesHeader[];
	};
	bounce?: {
		bounceType?: 'Undetermined' | 'Transient' | 'Permanent';
		bounceSubType?: string;
		bouncedRecipients?: SesRecipient[];
	};
	complaint?: {
		complainedRecipients?: SesRecipient[];
		complaintFeedbackType?: string;
		userAgent?: string;
	};
	delivery?: Record<string, unknown>;
	send?: Record<string, unknown>;
	reject?: { reason?: string };
	open?: { timestamp?: string; userAgent?: string; ipAddress?: string };
	click?: { timestamp?: string; link?: string; userAgent?: string; ipAddress?: string };
	deliveryDelay?: Record<string, unknown>;
	renderingFailure?: { errorMessage?: string; templateName?: string };
};

type Email = typeof emails.$inferSelect;

const STATUS_RANK = new Map<string, number>(emailStatuses.map((status, index) => [status, index]));

const DAILY_USAGE_COLUMNS = {
	sent: dailyEmailUsages.sent,
	delivered: dailyEmailUsages.delivered,
	opened: dailyEmailUsages.opened,
	clicked: dailyEmailUsages.clicked,
	bounced: dailyEmailUsages.bounced,
	complained: dailyEmailUsages.complained
} as const;

type DailyUsageField = keyof typeof DAILY_USAGE_COLUMNS;

const CUMULATED_COLUMNS = {
	delivered: cumulatedMetrics.delivered,
	hardBounced: cumulatedMetrics.hardBounced,
	complained: cumulatedMetrics.complained
} as const;

type CumulatedField = keyof typeof CUMULATED_COLUMNS;

/**
 * Enqueue a raw SES notification for asynchronous processing.
 */
export function queueSesHook(event: SesEvent): string {
	return enqueue(QUEUES.SES_WEBHOOK, event, { jobId: event.mail?.messageId });
}

function getEmailStatus(event: SesEvent): EmailStatus | undefined {
	switch (event.eventType) {
		case 'Send':
			return 'SENT';
		case 'Delivery':
			return 'DELIVERED';
		case 'Bounce':
			return 'BOUNCED';
		case 'Complaint':
			return 'COMPLAINED';
		case 'Reject':
			return 'REJECTED';
		case 'Open':
			return 'OPENED';
		case 'Click':
			return 'CLICKED';
		case 'Rendering Failure':
			return 'RENDERING_FAILURE';
		case 'DeliveryDelay':
			return 'DELIVERY_DELAYED';
		default:
			return undefined;
	}
}

function getEmailData(event: SesEvent): Record<string, unknown> | undefined {
	switch (event.eventType) {
		case 'Rendering Failure':
			return event.renderingFailure;
		case 'DeliveryDelay':
			return event.deliveryDelay;
		case 'Send':
			return event.send;
		case 'Delivery':
			return event.delivery;
		case 'Bounce':
			return event.bounce;
		case 'Complaint':
			return event.complaint;
		case 'Reject':
			return event.reject;
		case 'Open':
			return event.open;
		case 'Click':
			return event.click;
		default:
			return undefined;
	}
}

function emailStatusToEvent(status: EmailStatus): EmailWebhookEventType {
	switch (status) {
		case 'SENT':
			return 'email.sent';
		case 'DELIVERY_DELAYED':
			return 'email.delivery_delayed';
		case 'DELIVERED':
			return 'email.delivered';
		case 'BOUNCED':
			return 'email.bounced';
		case 'REJECTED':
			return 'email.rejected';
		case 'RENDERING_FAILURE':
			return 'email.rendering_failure';
		case 'COMPLAINED':
			return 'email.complained';
		case 'FAILED':
			return 'email.failed';
		case 'CANCELLED':
			return 'email.cancelled';
		case 'SUPPRESSED':
			return 'email.suppressed';
		case 'OPENED':
			return 'email.opened';
		case 'CLICKED':
			return 'email.clicked';
		default:
			return 'email.queued';
	}
}

function normalizeBounceSubType(
	subType: string | undefined
): EmailEventPayloadMap['email.bounced']['bounce']['subType'] {
	const normalized = subType?.replace(/\s+/g, '');
	const valid: EmailEventPayloadMap['email.bounced']['bounce']['subType'][] = [
		'General',
		'NoEmail',
		'Suppressed',
		'OnAccountSuppressionList',
		'MailboxFull',
		'MessageTooLarge',
		'ContentRejected',
		'AttachmentRejected'
	];
	if (normalized && (valid as string[]).includes(normalized)) {
		return normalized as EmailEventPayloadMap['email.bounced']['bounce']['subType'];
	}
	return 'General';
}

function buildEmailWebhookPayload(params: {
	email: Email;
	status: EmailStatus;
	occurredAt: string;
	event: SesEvent;
}): EmailEventPayloadMap[EmailWebhookEventType] {
	const { email, status, occurredAt, event } = params;

	const basePayload: EmailBasePayload = {
		id: email.id,
		status,
		from: email.from,
		to: parseTo(email.to),
		occurredAt,
		campaignId: email.campaignId ?? undefined,
		contactId: email.contactId ?? undefined,
		domainId: email.domainId ?? null,
		subject: email.subject
	};

	switch (status) {
		case 'BOUNCED':
			return {
				...basePayload,
				bounce: {
					type: event.bounce?.bounceType ?? 'Undetermined',
					subType: normalizeBounceSubType(event.bounce?.bounceSubType),
					message: event.bounce?.bouncedRecipients?.[0]?.diagnosticCode
				}
			};
		case 'OPENED':
			return {
				...basePayload,
				open: {
					timestamp: event.open?.timestamp ?? occurredAt,
					userAgent: event.open?.userAgent,
					ip: event.open?.ipAddress
				}
			};
		case 'CLICKED':
			return {
				...basePayload,
				click: {
					timestamp: event.click?.timestamp ?? occurredAt,
					url: event.click?.link ?? '',
					userAgent: event.click?.userAgent,
					ip: event.click?.ipAddress
				}
			};
		default:
			return basePayload;
	}
}

function parseTo(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

function incrementDailyUsage(params: {
	teamId: number;
	domainId: number;
	date: string;
	type: 'MARKETING' | 'TRANSACTIONAL';
	field: DailyUsageField;
	hardBounced: boolean;
}): void {
	const { teamId, domainId, date, type, field, hardBounced } = params;
	const column = DAILY_USAGE_COLUMNS[field];

	const set: Record<string, unknown> = {
		[field]: sql`${column} + 1`,
		updatedAt: sql`(datetime('now'))`
	};
	if (hardBounced) {
		set.hardBounced = sql`${dailyEmailUsages.hardBounced} + 1`;
	}

	db.insert(dailyEmailUsages)
		.values({
			teamId,
			domainId,
			date,
			type,
			sent: field === 'sent' ? 1 : 0,
			delivered: field === 'delivered' ? 1 : 0,
			opened: field === 'opened' ? 1 : 0,
			clicked: field === 'clicked' ? 1 : 0,
			bounced: field === 'bounced' ? 1 : 0,
			complained: field === 'complained' ? 1 : 0,
			hardBounced: hardBounced ? 1 : 0
		})
		.onConflictDoUpdate({
			target: [
				dailyEmailUsages.teamId,
				dailyEmailUsages.domainId,
				dailyEmailUsages.date,
				dailyEmailUsages.type
			],
			set
		})
		.run();
}

function incrementCumulatedMetric(params: {
	teamId: number;
	domainId: number;
	field: CumulatedField;
}): void {
	const { teamId, domainId, field } = params;
	const column = CUMULATED_COLUMNS[field];

	db.insert(cumulatedMetrics)
		.values({
			teamId,
			domainId,
			delivered: field === 'delivered' ? 1 : 0,
			hardBounced: field === 'hardBounced' ? 1 : 0,
			complained: field === 'complained' ? 1 : 0
		})
		.onConflictDoUpdate({
			target: [cumulatedMetrics.teamId, cumulatedMetrics.domainId],
			set: { [field]: sql`${column} + 1` }
		})
		.run();
}

async function checkUnsubscribe(params: {
	contactId: string;
	campaignId: string;
	teamId: number;
	status: EmailStatus;
	event: SesEvent;
}): Promise<void> {
	const { contactId, campaignId, teamId, status, event } = params;

	const isPermanentBounce =
		status === 'BOUNCED' && event.bounce?.bounceType === 'Permanent';
	if (!isPermanentBounce && status !== 'COMPLAINED') {
		return;
	}

	const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
	if (!contact) {
		return;
	}

	const reason = status === 'BOUNCED' ? 'BOUNCED' : 'COMPLAINED';

	// Unsubscribe every contact sharing this email address within the team.
	const sameEmailContacts = db
		.select({ id: contacts.id })
		.from(contacts)
		.innerJoin(contactBooks, eq(contacts.contactBookId, contactBooks.id))
		.where(and(eq(contacts.email, contact.email), eq(contactBooks.teamId, teamId)))
		.all();

	for (const row of sameEmailContacts) {
		await unsubscribeContact({
			contactId: row.id,
			campaignId: row.id === contactId ? campaignId : undefined,
			reason
		});
	}
}

/**
 * Parse and apply a single SES notification: update the email status
 * monotonically, record the event, update usage metrics, suppress hard
 * bounces/complaints, emit webhooks and update campaign analytics.
 */
export async function parseSesHook(event: SesEvent): Promise<boolean> {
	const mailStatus = getEmailStatus(event);
	if (!mailStatus) {
		console.error('[ses-hook] Unknown email status', event.eventType);
		return false;
	}

	const sesEmailId = event.mail?.messageId;
	const mailData = getEmailData(event);

	let email = sesEmailId
		? (db.select().from(emails).where(eq(emails.sesEmailId, sesEmailId)).get() ?? null)
		: null;

	// Race condition fallback: match by the custom email id header.
	if (!email) {
		const header = event.mail?.headers?.find(
			(h) => h.name === 'X-Usesend-Email-ID' || h.name === 'X-Unsend-Email-ID'
		);
		if (header?.value) {
			email = db.select().from(emails).where(eq(emails.id, header.value)).get() ?? null;
			if (email && sesEmailId) {
				db.update(emails)
					.set({ sesEmailId, updatedAt: sql`(datetime('now'))` })
					.where(eq(emails.id, email.id))
					.run();
			}
		}
	}

	if (!email) {
		console.error('[ses-hook] Email not found', { sesEmailId });
		return false;
	}

	if (email.latestStatus === mailStatus && mailStatus === 'DELIVERY_DELAYED') {
		return true;
	}

	const isEngagementEvent = mailStatus === 'OPENED' || mailStatus === 'CLICKED';
	const existingMailEvent =
		email.campaignId || isEngagementEvent
			? (db
					.select({ id: emailEvents.id })
					.from(emailEvents)
					.where(and(eq(emailEvents.emailId, email.id), eq(emailEvents.status, mailStatus)))
					.get() ?? null)
			: null;

	// Monotonic status update: never downgrade an already-advanced status.
	const currentRank = STATUS_RANK.get(email.latestStatus) ?? -1;
	const newRank = STATUS_RANK.get(mailStatus) ?? -1;
	if (newRank > currentRank || email.latestStatus === 'SCHEDULED') {
		db.update(emails)
			.set({ latestStatus: mailStatus, updatedAt: sql`(datetime('now'))` })
			.where(eq(emails.id, email.id))
			.run();
	}

	const today = new Date().toISOString().slice(0, 10);
	const isHardBounced =
		mailStatus === 'BOUNCED' && event.bounce?.bounceType === 'Permanent';

	// Suppress the affected recipients on hard bounce/complaint.
	if (isHardBounced || mailStatus === 'COMPLAINED') {
		const recipientEmails = isHardBounced
			? (event.bounce?.bouncedRecipients?.map((r) => r.emailAddress) ?? [])
			: (event.complaint?.complainedRecipients?.map((r) => r.emailAddress) ?? []);

		for (const recipientEmail of recipientEmails) {
			try {
				await addSuppression({
					email: recipientEmail,
					teamId: email.teamId,
					reason: isHardBounced ? 'HARD_BOUNCE' : 'COMPLAINT',
					source: email.id
				});
			} catch (error) {
				console.error('[ses-hook] Failed to add suppression', { recipientEmail, error });
			}
		}
	}

	const isDuplicateEngagement = Boolean(existingMailEvent) && isEngagementEvent;

	if (
		!isDuplicateEngagement &&
		['DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'SENT'].includes(mailStatus)
	) {
		const field = mailStatus.toLowerCase() as DailyUsageField;
		incrementDailyUsage({
			teamId: email.teamId,
			domainId: email.domainId ?? 0,
			date: today,
			type: email.campaignId ? 'MARKETING' : 'TRANSACTIONAL',
			field,
			hardBounced: isHardBounced
		});

		if (isHardBounced || field === 'complained' || field === 'delivered') {
			const cumulatedField: CumulatedField = isHardBounced
				? 'hardBounced'
				: (field as CumulatedField);
			incrementCumulatedMetric({
				teamId: email.teamId,
				domainId: email.domainId ?? 0,
				field: cumulatedField
			});
		}
	}

	if (email.campaignId) {
		const isUnsubClick =
			mailStatus === 'CLICKED' &&
			Boolean(event.click?.link?.startsWith(`${env.HOST_URL}/unsubscribe`));

		if (!isUnsubClick) {
			if (email.contactId) {
				await checkUnsubscribe({
					contactId: email.contactId,
					campaignId: email.campaignId,
					teamId: email.teamId,
					status: mailStatus,
					event
				});
			}

			if (!existingMailEvent) {
				await updateCampaignAnalytics(email.campaignId, mailStatus, isHardBounced);
			}
		}
	}

	db.insert(emailEvents)
		.values({
			id: cuid(),
			emailId: email.id,
			status: mailStatus,
			data: mailData ? JSON.stringify(mailData) : null,
			teamId: email.teamId
		})
		.run();

	try {
		const occurredAt = event.mail?.timestamp
			? new Date(event.mail.timestamp).toISOString()
			: new Date().toISOString();

		await webhookService.emit(
			email.teamId,
			emailStatusToEvent(mailStatus),
			buildEmailWebhookPayload({ email, status: mailStatus, occurredAt, event }),
			{ domainId: email.domainId ?? null }
		);
	} catch (error) {
		console.error('[ses-hook] Failed to emit webhook', { emailId: email.id, error });
	}

	return true;
}
