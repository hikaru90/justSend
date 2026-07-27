import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { cuid, jsonArray, nowIso, parseJsonArray, parseJsonObject } from '$lib/utils';
import { db } from '../db';
import { env } from '../env';
import {
	campaignEmails,
	campaigns,
	contactBooks,
	contacts,
	domains,
	emails,
	emailEvents,
	type EmailStatus,
	type UnsubscribeReason
} from '../db/schema';
import { renderEmailHtml } from '$lib/email-editor/renderer';
import { enqueue } from '../queue';
import { QUEUES } from '../queue/constants';
import { validateApiKeyDomainAccess, validateDomainFromEmail } from './domain-service';
import { checkMultipleEmails } from './suppression-service';
import { queueEmail } from './email-queue-service';
import { apiKeys } from '../db/schema';
import { updateContactSubscription } from './contact-service';

export type Campaign = typeof campaigns.$inferSelect;
type Contact = typeof contacts.$inferSelect;

const BUILT_IN_CONTACT_VARIABLES = ['email', 'firstName', 'lastName'] as const;

const CAMPAIGN_UNSUB_PLACEHOLDER_TOKENS = [
	'unsend_unsubscribe_url',
	'usesend_unsubscribe_url'
] as const;

const CAMPAIGN_UNSUB_PLACEHOLDER_REGEXES = CAMPAIGN_UNSUB_PLACEHOLDER_TOKENS.map(
	(token) => new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, 'i')
);

function campaignHasUnsubscribePlaceholder(...sources: Array<string | null | undefined>): boolean {
	return CAMPAIGN_UNSUB_PLACEHOLDER_REGEXES.some((regex) =>
		sources.some((source) => (source ? regex.test(source) : false))
	);
}

function replaceUnsubscribePlaceholders(html: string, url: string): string {
	return CAMPAIGN_UNSUB_PLACEHOLDER_REGEXES.reduce(
		(acc, regex) => acc.replace(new RegExp(regex.source, 'gi'), url),
		html
	);
}

function sanitizeAddressList(addresses?: string | string[]): string[] {
	if (!addresses) return [];
	const list = Array.isArray(addresses) ? addresses : [addresses];
	return list.map((a) => a.trim()).filter((a) => a.length > 0);
}

function getContactValue(contact: Contact, key: string): string | undefined {
	const normalized = key.toLowerCase();
	if (normalized === 'email') return contact.email;
	if (normalized === 'firstname') return contact.firstName ?? undefined;
	if (normalized === 'lastname') return contact.lastName ?? undefined;

	const properties = parseJsonObject(contact.properties);
	const match = Object.keys(properties).find((k) => k.toLowerCase() === normalized);
	if (match && properties[match] != null) {
		return String(properties[match]);
	}
	return undefined;
}

function buildContactVariables(
	contact: Contact,
	allowedVariables: string[],
	unsubscribeUrl: string
): Record<string, string> {
	const variables: Record<string, string> = {
		email: contact.email,
		firstName: contact.firstName ?? '',
		lastName: contact.lastName ?? ''
	};

	for (const variable of allowedVariables) {
		const value = getContactValue(contact, variable);
		if (value !== undefined) {
			variables[variable] = value;
		}
	}

	for (const token of CAMPAIGN_UNSUB_PLACEHOLDER_TOKENS) {
		variables[token] = unsubscribeUrl;
	}

	return variables;
}

// ---------------------------------------------------------------------------
// Unsubscribe links
// ---------------------------------------------------------------------------

export function createUnsubUrl(contactId: string, campaignId: string): string {
	const unsubId = `${contactId}-${campaignId}`;
	const unsubHash = createHash('sha256').update(`${unsubId}-${env.AUTH_SECRET}`).digest('hex');
	return `${env.HOST_URL}/unsubscribe?id=${unsubId}&hash=${unsubHash}`;
}

export function createOneClickUnsubUrl(contactId: string, campaignId: string): string {
	const unsubId = `${contactId}-${campaignId}`;
	const unsubHash = createHash('sha256').update(`${unsubId}-${env.AUTH_SECRET}`).digest('hex');
	return `${env.HOST_URL}/api/unsubscribe-oneclick?id=${unsubId}&hash=${unsubHash}`;
}

function verifyUnsubscribeLink(id: string, hash: string): { contactId: string; campaignId: string } {
	const [contactId, campaignId] = id.split('-');
	if (!contactId || !campaignId) {
		throw new Error('Invalid unsubscribe link');
	}
	const expectedHash = createHash('sha256').update(`${id}-${env.AUTH_SECRET}`).digest('hex');
	if (hash !== expectedHash) {
		throw new Error('Invalid unsubscribe link');
	}
	return { contactId, campaignId };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function prepareCampaignHtml(campaign: Campaign): { campaign: Campaign; html: string } {
	if (campaign.content) {
		const html = renderEmailHtml(campaign.content, campaign.html);
		if (campaign.html !== html) {
			const updated = db
				.update(campaigns)
				.set({ html, updatedAt: nowIso() })
				.where(eq(campaigns.id, campaign.id))
				.returning()
				.get();
			return { campaign: updated, html };
		}
		return { campaign, html };
	}

	if (campaign.html) {
		return { campaign, html: campaign.html };
	}

	throw new Error('No content added for campaign');
}

function renderCampaignHtmlForContact(params: {
	campaign: Campaign;
	contact: Contact;
	unsubscribeUrl: string;
	allowedVariables: string[];
}): string {
	const { campaign, contact, unsubscribeUrl, allowedVariables } = params;
	const variables = buildContactVariables(contact, allowedVariables, unsubscribeUrl);

	if (campaign.content) {
		return renderEmailHtml(campaign.content, campaign.html, variables);
	}

	if (!campaign.html) {
		throw new Error('No HTML content for campaign');
	}

	let html = replaceUnsubscribePlaceholders(campaign.html, unsubscribeUrl);
	html = renderEmailHtml(null, html, variables);
	return html;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export type CreateCampaignInput = {
	teamId: number;
	name: string;
	from: string;
	subject: string;
	previewText?: string;
	content?: string;
	html?: string;
	contactBookId?: string;
	replyTo?: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	batchSize?: number;
};

export async function createCampaign(input: CreateCampaignInput): Promise<Campaign> {
	const domain = await validateDomainFromEmail(input.from, input.teamId);

	return db
		.insert(campaigns)
		.values({
			id: cuid(),
			name: input.name,
			teamId: input.teamId,
			from: input.from,
			subject: input.subject,
			previewText: input.previewText ?? null,
			content: input.content ?? null,
			html: input.html ?? null,
			contactBookId: input.contactBookId ?? null,
			replyTo: jsonArray(sanitizeAddressList(input.replyTo)),
			cc: jsonArray(sanitizeAddressList(input.cc)),
			bcc: jsonArray(sanitizeAddressList(input.bcc)),
			domainId: domain.id,
			status: 'DRAFT',
			...(typeof input.batchSize === 'number' ? { batchSize: input.batchSize } : {})
		})
		.returning()
		.get();
}

export async function createCampaignFromApi(input: {
	teamId: number;
	apiKeyId?: number;
	name: string;
	from: string;
	subject: string;
	previewText?: string;
	content?: string;
	html?: string;
	contactBookId: string;
	replyTo?: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	batchSize?: number;
}): Promise<Campaign> {
	if (!input.content && !input.html) {
		throw new Error('Either content or html must be provided');
	}

	if (input.content) {
		try {
			JSON.parse(input.content);
		} catch {
			throw new Error('Invalid content JSON');
		}
	}

	const contactBook = db
		.select({ id: contactBooks.id })
		.from(contactBooks)
		.where(and(eq(contactBooks.id, input.contactBookId), eq(contactBooks.teamId, input.teamId)))
		.get();
	if (!contactBook) {
		throw new Error('Contact book not found');
	}

	let domain: Awaited<ReturnType<typeof validateDomainFromEmail>>;
	if (input.apiKeyId) {
		const apiKeyRow = db.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId)).get();
		if (!apiKeyRow || apiKeyRow.teamId !== input.teamId) {
			throw new Error('Invalid API key');
		}
		const apiKeyDomain = apiKeyRow.domainId
			? (db
					.select({ name: domains.name })
					.from(domains)
					.where(eq(domains.id, apiKeyRow.domainId))
					.get() ?? null)
			: null;
		domain = await validateApiKeyDomainAccess(input.from, input.teamId, {
			...apiKeyRow,
			domain: apiKeyDomain
		});
	} else {
		domain = await validateDomainFromEmail(input.from, input.teamId);
	}

	const sanitizedHtml = input.html?.trim();
	const sanitizedContent = input.content ?? null;

	if (!campaignHasUnsubscribePlaceholder(sanitizedContent, sanitizedHtml)) {
		throw new Error('Campaign must include an unsubscribe link before sending');
	}

	return db
		.insert(campaigns)
		.values({
			id: cuid(),
			name: input.name,
			teamId: input.teamId,
			from: input.from,
			subject: input.subject,
			isApi: true,
			previewText: input.previewText ?? null,
			content: sanitizedContent,
			html: sanitizedHtml && sanitizedHtml.length > 0 ? sanitizedHtml : null,
			contactBookId: input.contactBookId,
			replyTo: jsonArray(sanitizeAddressList(input.replyTo)),
			cc: jsonArray(sanitizeAddressList(input.cc)),
			bcc: jsonArray(sanitizeAddressList(input.bcc)),
			domainId: domain.id,
			status: 'DRAFT',
			...(typeof input.batchSize === 'number' ? { batchSize: input.batchSize } : {})
		})
		.returning()
		.get();
}

export function getCampaign(campaignId: string, teamId: number): Campaign {
	const campaign = db
		.select()
		.from(campaigns)
		.where(and(eq(campaigns.id, campaignId), eq(campaigns.teamId, teamId)))
		.get();
	if (!campaign) {
		throw new Error('Campaign not found');
	}
	return campaign;
}

export function listCampaigns(teamId: number, options?: { limit?: number; cursor?: string }): {
	items: Campaign[];
	nextCursor: string | null;
} {
	const limit = options?.limit ?? 30;
	const conditions = [eq(campaigns.teamId, teamId)];
	if (options?.cursor) {
		conditions.push(lt(campaigns.id, options.cursor));
	}

	const rows = db
		.select()
		.from(campaigns)
		.where(and(...conditions))
		.orderBy(desc(campaigns.createdAt))
		.limit(limit + 1)
		.all();

	let nextCursor: string | null = null;
	if (rows.length > limit) {
		const next = rows.pop();
		nextCursor = next?.id ?? null;
	}

	return { items: rows, nextCursor };
}

export type UpdateCampaignInput = {
	name?: string;
	from?: string;
	subject?: string;
	previewText?: string | null;
	content?: string | null;
	html?: string | null;
	contactBookId?: string | null;
	replyTo?: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	batchSize?: number;
	batchWindowMinutes?: number;
};

export async function updateCampaign(
	campaignId: string,
	teamId: number,
	data: UpdateCampaignInput
): Promise<Campaign> {
	const campaign = getCampaign(campaignId, teamId);

	const updateData: Record<string, unknown> = { updatedAt: nowIso() };

	if (data.name !== undefined) updateData.name = data.name;
	if (data.subject !== undefined) updateData.subject = data.subject;
	if (data.previewText !== undefined) updateData.previewText = data.previewText;
	if (data.content !== undefined) updateData.content = data.content;
	if (data.html !== undefined) updateData.html = data.html;
	if (data.contactBookId !== undefined) updateData.contactBookId = data.contactBookId;
	if (data.replyTo !== undefined) updateData.replyTo = jsonArray(sanitizeAddressList(data.replyTo));
	if (data.cc !== undefined) updateData.cc = jsonArray(sanitizeAddressList(data.cc));
	if (data.bcc !== undefined) updateData.bcc = jsonArray(sanitizeAddressList(data.bcc));
	if (data.batchSize !== undefined) updateData.batchSize = data.batchSize;
	if (data.batchWindowMinutes !== undefined) updateData.batchWindowMinutes = data.batchWindowMinutes;

	if (data.from !== undefined) {
		const domain = await validateDomainFromEmail(data.from, teamId);
		updateData.from = data.from;
		updateData.domainId = domain.id;
	}

	return db
		.update(campaigns)
		.set(updateData)
		.where(eq(campaigns.id, campaign.id))
		.returning()
		.get();
}

export function deleteCampaign(campaignId: string, teamId: number): Campaign {
	const campaign = getCampaign(campaignId, teamId);
	db.delete(campaignEmails).where(eq(campaignEmails.campaignId, campaignId)).run();
	db.delete(campaigns).where(eq(campaigns.id, campaignId)).run();
	return campaign;
}

// ---------------------------------------------------------------------------
// Scheduling / sending
// ---------------------------------------------------------------------------

function countSubscribedContacts(contactBookId: string): number {
	const row = db
		.select({ value: sql<number>`count(*)` })
		.from(contacts)
		.where(and(eq(contacts.contactBookId, contactBookId), eq(contacts.subscribed, true)))
		.get();
	return row?.value ?? 0;
}

export async function sendCampaign(id: string): Promise<void> {
	let campaign = db.select().from(campaigns).where(eq(campaigns.id, id)).get();
	if (!campaign) {
		throw new Error('Campaign not found');
	}

	const prepared = prepareCampaignHtml(campaign);
	campaign = prepared.campaign;
	const html = prepared.html;

	if (!campaign.contactBookId) {
		throw new Error('No contact book found for campaign');
	}

	if (!campaignHasUnsubscribePlaceholder(campaign.content, html)) {
		throw new Error('Campaign must include an unsubscribe link before sending');
	}

	const total = countSubscribedContacts(campaign.contactBookId);

	db.update(campaigns)
		.set({
			status: 'SCHEDULED',
			total,
			scheduledAt: campaign.scheduledAt ?? nowIso(),
			lastCursor: campaign.lastCursor ?? null,
			updatedAt: nowIso()
		})
		.where(eq(campaigns.id, id))
		.run();

	enqueue(
		QUEUES.CAMPAIGN_BATCH,
		{ campaignId: id, teamId: campaign.teamId },
		{ jobId: `campaign-batch:${id}:start` }
	);
}

export async function scheduleCampaign(params: {
	campaignId: string;
	teamId: number;
	scheduledAt?: Date | string;
	batchSize?: number;
}): Promise<{ ok: true }> {
	let campaign = getCampaign(params.campaignId, params.teamId);

	const prepared = prepareCampaignHtml(campaign);
	campaign = prepared.campaign;
	const html = prepared.html;

	if (!campaign.contactBookId) {
		throw new Error('No contact book found for campaign');
	}

	if (!campaignHasUnsubscribePlaceholder(campaign.content, html)) {
		throw new Error('Campaign must include an unsubscribe link before scheduling');
	}

	const total = countSubscribedContacts(campaign.contactBookId);
	if (total === 0) {
		throw new Error('No subscribed contacts to send');
	}

	const scheduledAt = params.scheduledAt
		? params.scheduledAt instanceof Date
			? params.scheduledAt
			: new Date(params.scheduledAt)
		: new Date();

	const shouldResetCursor = campaign.status === 'DRAFT' || campaign.status === 'SENT';

	db.update(campaigns)
		.set({
			status: 'SCHEDULED',
			scheduledAt: scheduledAt.toISOString(),
			total,
			...(params.batchSize ? { batchSize: params.batchSize } : {}),
			...(shouldResetCursor ? { lastCursor: null } : {}),
			updatedAt: nowIso()
		})
		.where(eq(campaigns.id, campaign.id))
		.run();

	return { ok: true };
}

export function pauseCampaign(params: { campaignId: string; teamId: number }): { ok: true } {
	const campaign = getCampaign(params.campaignId, params.teamId);
	db.update(campaigns)
		.set({ status: 'PAUSED', updatedAt: nowIso() })
		.where(eq(campaigns.id, campaign.id))
		.run();
	return { ok: true };
}

export function resumeCampaign(params: { campaignId: string; teamId: number }): { ok: true } {
	const campaign = getCampaign(params.campaignId, params.teamId);

	const isFuture =
		campaign.scheduledAt != null && new Date(campaign.scheduledAt).getTime() > Date.now();

	db.update(campaigns)
		.set({ status: isFuture ? 'SCHEDULED' : 'RUNNING', updatedAt: nowIso() })
		.where(eq(campaigns.id, campaign.id))
		.run();

	if (!isFuture) {
		enqueue(QUEUES.CAMPAIGN_BATCH, { campaignId: campaign.id, teamId: campaign.teamId });
	}

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Batch processing
// ---------------------------------------------------------------------------

async function processContactEmail(params: {
	contact: Contact;
	campaign: Campaign;
	allowedVariables: string[];
	domainId: number;
	region: string;
}): Promise<void> {
	const { contact, campaign, allowedVariables, domainId, region } = params;

	const unsubscribeUrl = createUnsubUrl(contact.id, campaign.id);
	const oneClickUnsubUrl = createOneClickUnsubUrl(contact.id, campaign.id);

	const ccEmails = parseJsonArray(campaign.cc);
	const bccEmails = parseJsonArray(campaign.bcc);
	const replyToEmails = parseJsonArray(campaign.replyTo);

	const allEmailsToCheck = [...new Set([contact.email, ...ccEmails, ...bccEmails])];
	const suppressionResults = await checkMultipleEmails(allEmailsToCheck, campaign.teamId);

	const contactSuppressed = Boolean(suppressionResults[contact.email]);
	const filteredCc = ccEmails.filter((email) => !suppressionResults[email]);
	const filteredBcc = bccEmails.filter((email) => !suppressionResults[email]);

	const html = renderCampaignHtmlForContact({ campaign, contact, unsubscribeUrl, allowedVariables });
	const subject = renderEmailHtml(
		null,
		campaign.subject,
		buildContactVariables(contact, allowedVariables, unsubscribeUrl)
	);

	if (contactSuppressed) {
		const email = db
			.insert(emails)
			.values({
				id: cuid(),
				to: jsonArray([contact.email]),
				replyTo: jsonArray(replyToEmails),
				cc: jsonArray(ccEmails),
				bcc: jsonArray(bccEmails),
				from: campaign.from,
				subject,
				html,
				text: campaign.previewText ?? null,
				teamId: campaign.teamId,
				campaignId: campaign.id,
				contactId: contact.id,
				domainId,
				latestStatus: 'SUPPRESSED'
			})
			.returning()
			.get();

		db.insert(emailEvents)
			.values({
				id: cuid(),
				emailId: email.id,
				status: 'SUPPRESSED',
				data: JSON.stringify({ error: 'Contact email is suppressed. No email sent.' }),
				teamId: campaign.teamId
			})
			.run();

		db.insert(campaignEmails)
			.values({ campaignId: campaign.id, contactId: contact.id, emailId: email.id })
			.run();

		return;
	}

	const email = db
		.insert(emails)
		.values({
			id: cuid(),
			to: jsonArray([contact.email]),
			replyTo: jsonArray(replyToEmails),
			cc: jsonArray(filteredCc),
			bcc: jsonArray(filteredBcc),
			from: campaign.from,
			subject,
			html,
			text: campaign.previewText ?? null,
			teamId: campaign.teamId,
			campaignId: campaign.id,
			contactId: contact.id,
			domainId,
			latestStatus: 'QUEUED'
		})
		.returning()
		.get();

	db.insert(campaignEmails)
		.values({ campaignId: campaign.id, contactId: contact.id, emailId: email.id })
		.run();

	queueEmail(email.id, campaign.teamId, region, false, oneClickUnsubUrl);
}

/**
 * Queue handler for {@link QUEUES.CAMPAIGN_BATCH}. Processes one batch of
 * subscribed contacts and enqueues the next batch until the campaign is fully
 * sent.
 */
export async function processCampaignBatch(payload: unknown): Promise<void> {
	const { campaignId } = (payload ?? {}) as { campaignId?: string };
	if (!campaignId) return;

	const campaign = db.select().from(campaigns).where(eq(campaigns.id, campaignId)).get();
	if (!campaign || !campaign.contactBookId) return;

	if (campaign.status === 'PAUSED' || campaign.status === 'SENT') return;

	if (campaign.scheduledAt && new Date(campaign.scheduledAt).getTime() > Date.now()) {
		return;
	}

	if (campaign.status === 'SCHEDULED') {
		db.update(campaigns)
			.set({ status: 'RUNNING', updatedAt: nowIso() })
			.where(eq(campaigns.id, campaignId))
			.run();
	}

	const batchSize = campaign.batchSize ?? 500;

	const contactConditions = [
		eq(contacts.contactBookId, campaign.contactBookId),
		eq(contacts.subscribed, true)
	];
	if (campaign.lastCursor) {
		contactConditions.push(gt(contacts.id, campaign.lastCursor));
	}

	const batchContacts = db
		.select()
		.from(contacts)
		.where(and(...contactConditions))
		.orderBy(asc(contacts.id))
		.limit(batchSize)
		.all();

	if (batchContacts.length === 0) {
		db.update(campaigns)
			.set({ status: 'SENT', updatedAt: nowIso() })
			.where(eq(campaigns.id, campaignId))
			.run();
		return;
	}

	const contactBook = db
		.select({ variables: contactBooks.variables })
		.from(contactBooks)
		.where(eq(contactBooks.id, campaign.contactBookId))
		.get();

	const allowedVariables = [
		...BUILT_IN_CONTACT_VARIABLES,
		...parseJsonArray(contactBook?.variables)
	];

	const domain = db.select().from(domains).where(eq(domains.id, campaign.domainId)).get();
	if (!domain) return;

	const existing = db
		.select({ contactId: campaignEmails.contactId })
		.from(campaignEmails)
		.where(eq(campaignEmails.campaignId, campaign.id))
		.all();
	const existingSet = new Set(existing.map((e) => e.contactId));

	for (const contact of batchContacts) {
		if (existingSet.has(contact.id)) continue;
		try {
			await processContactEmail({
				contact,
				campaign,
				allowedVariables,
				domainId: domain.id,
				region: domain.region
			});
		} catch (error) {
			console.error('[campaign] Failed to process contact; skipping', {
				contactId: contact.id,
				campaignId,
				error
			});
		}
	}

	const newCursor = batchContacts[batchContacts.length - 1]?.id ?? campaign.lastCursor;
	db.update(campaigns)
		.set({ lastCursor: newCursor, lastSentAt: nowIso(), updatedAt: nowIso() })
		.where(eq(campaigns.id, campaignId))
		.run();

	// Continue with the next batch. No jobId so it is not deduped against the
	// completed batch job for the same campaign.
	const delayMs = (campaign.batchWindowMinutes ?? 0) * 60_000;
	enqueue(
		QUEUES.CAMPAIGN_BATCH,
		{ campaignId, teamId: campaign.teamId },
		delayMs > 0 ? { delayMs } : {}
	);
}

// ---------------------------------------------------------------------------
// Analytics + subscription
// ---------------------------------------------------------------------------

export async function updateCampaignAnalytics(
	campaignId: string,
	emailStatus: EmailStatus,
	hardBounce = false
): Promise<void> {
	const campaign = db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, campaignId)).get();
	if (!campaign) {
		throw new Error('Campaign not found');
	}

	const set: Record<string, unknown> = {};

	switch (emailStatus) {
		case 'SENT':
			set.sent = sql`${campaigns.sent} + 1`;
			break;
		case 'DELIVERED':
			set.delivered = sql`${campaigns.delivered} + 1`;
			break;
		case 'OPENED':
			set.opened = sql`${campaigns.opened} + 1`;
			break;
		case 'CLICKED':
			set.clicked = sql`${campaigns.clicked} + 1`;
			break;
		case 'BOUNCED':
			set.bounced = sql`${campaigns.bounced} + 1`;
			if (hardBounce) {
				set.hardBounced = sql`${campaigns.hardBounced} + 1`;
			}
			break;
		case 'COMPLAINED':
			set.complained = sql`${campaigns.complained} + 1`;
			break;
		default:
			return;
	}

	db.update(campaigns).set(set).where(eq(campaigns.id, campaignId)).run();
}

/**
 * Unsubscribe a contact, optionally attributing it to a campaign for counts.
 */
export async function unsubscribeContact(params: {
	contactId: string;
	campaignId?: string;
	reason: UnsubscribeReason;
}): Promise<Contact> {
	const contact = db.select().from(contacts).where(eq(contacts.id, params.contactId)).get();
	if (!contact) {
		throw new Error('Contact not found');
	}

	if (!contact.subscribed) {
		return contact;
	}

	const updated = await updateContactSubscription({
		contactId: params.contactId,
		subscribed: false,
		unsubscribeReason: params.reason
	});

	if (params.campaignId) {
		db.update(campaigns)
			.set({ unsubscribed: sql`${campaigns.unsubscribed} + 1`, updatedAt: nowIso() })
			.where(eq(campaigns.id, params.campaignId))
			.run();
	}

	return updated;
}

export async function unsubscribeContactFromLink(id: string, hash: string): Promise<Contact> {
	const { contactId, campaignId } = verifyUnsubscribeLink(id, hash);
	return unsubscribeContact({ contactId, campaignId, reason: 'UNSUBSCRIBED' });
}

/**
 * Re-subscribe a contact from a signed subscribe link.
 */
export async function subscribeContact(id: string, hash: string): Promise<boolean> {
	const { contactId, campaignId } = verifyUnsubscribeLink(id, hash);

	const contact = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
	if (!contact) {
		throw new Error('Contact not found');
	}

	if (!contact.subscribed) {
		await updateContactSubscription({
			contactId,
			subscribed: true,
			unsubscribeReason: null
		});

		db.update(campaigns)
			.set({ unsubscribed: sql`${campaigns.unsubscribed} - 1`, updatedAt: nowIso() })
			.where(eq(campaigns.id, campaignId))
			.run();
	}

	return true;
}
