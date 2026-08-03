import { and, desc, eq } from 'drizzle-orm';
import { resolveTxt } from 'node:dns/promises';
import * as tldts from 'tldts';
import { db } from '../db';
import { apiKeys, domains, domainStatuses, type DomainStatus } from '../db/schema';
import * as ses from '../aws/ses';
import { getSetting } from './ses-settings-service';
import { checkDomainLimit } from './limit-service';
import * as webhookService from './webhook-service';
import { type DomainPayload, type DomainWebhookEventType } from '../webhook-events';

export type Domain = typeof domains.$inferSelect;

export type DomainDnsRecord = {
	type: 'MX' | 'TXT';
	name: string;
	value: string;
	ttl: string;
	priority?: string;
	status: DomainStatus;
	recommended?: boolean;
};

export type DomainWithDnsRecords = Domain & { dnsRecords: DomainDnsRecord[] };

const DOMAIN_STATUS_VALUES = new Set<string>(domainStatuses);

function parseDomainStatus(status?: string | null): DomainStatus {
	if (!status) return 'NOT_STARTED';
	const normalized = status.toUpperCase();
	if (DOMAIN_STATUS_VALUES.has(normalized)) {
		return normalized as DomainStatus;
	}
	return 'NOT_STARTED';
}

export function getDnsRecords(domain: Domain): DomainDnsRecord[] {
	const subdomainSuffix = domain.subdomain ? `.${domain.subdomain}` : '';
	const mailDomain = `mail${subdomainSuffix}`;
	const dkimSelector = domain.dkimSelector ?? 'owlery';

	const spfStatus = parseDomainStatus(domain.spfDetails);
	const dkimStatus = parseDomainStatus(domain.dkimStatus);
	const dmarcStatus: DomainStatus = domain.dmarcAdded ? 'SUCCESS' : 'NOT_STARTED';

	return [
		{
			type: 'MX',
			name: mailDomain,
			value: `feedback-smtp.${domain.region}.amazonses.com`,
			ttl: 'Auto',
			priority: '10',
			status: spfStatus,
		},
		{
			type: 'TXT',
			name: `${dkimSelector}._domainkey${subdomainSuffix}`,
			value: `p=${domain.publicKey}`,
			ttl: 'Auto',
			status: dkimStatus,
		},
		{
			type: 'TXT',
			name: mailDomain,
			value: 'v=spf1 include:amazonses.com ~all',
			ttl: 'Auto',
			status: spfStatus,
		},
		{
			type: 'TXT',
			name: '_dmarc',
			value: 'v=DMARC1; p=none;',
			ttl: 'Auto',
			status: dmarcStatus,
			recommended: true,
		},
	];
}

function withDnsRecords(domain: Domain): DomainWithDnsRecords {
	return { ...domain, dnsRecords: getDnsRecords(domain) };
}

function buildDomainPayload(domain: Domain): DomainPayload {
	return {
		id: domain.id,
		name: domain.name,
		status: domain.status,
		region: domain.region,
		createdAt: domain.createdAt,
		updatedAt: domain.updatedAt,
		clickTracking: domain.clickTracking,
		openTracking: domain.openTracking,
		subdomain: domain.subdomain,
		sesTenantId: domain.sesTenantId,
		dkimStatus: domain.dkimStatus,
		spfDetails: domain.spfDetails,
		dmarcAdded: domain.dmarcAdded,
	};
}

async function emitDomainEvent(domain: Domain, type: DomainWebhookEventType): Promise<void> {
	try {
		await webhookService.emit(domain.teamId, type, buildDomainPayload(domain), {
			domainId: domain.id,
		});
	} catch (error) {
		console.error('[domain] Failed to emit domain webhook event', {
			domainId: domain.id,
			type,
			error,
		});
	}
}

async function getDmarcRecord(domain: string): Promise<string[][] | null> {
	try {
		return await resolveTxt(`_dmarc.${domain}`);
	} catch {
		return null;
	}
}

function shouldContinueVerifying(
	verificationStatus: DomainStatus,
	dkimStatus: string | undefined,
	spfDetails: string | undefined,
): boolean {
	if (verificationStatus === 'SUCCESS' && dkimStatus === 'SUCCESS' && spfDetails === 'SUCCESS') {
		return false;
	}
	return verificationStatus !== 'FAILED';
}

export async function validateDomainFromEmail(email: string, teamId: number): Promise<Domain> {
	const match = email.match(/<([^>]+)>/);
	let fromDomain: string | undefined;

	if (match && match[1]) {
		const parts = match[1].split('@');
		fromDomain = parts.length > 1 ? parts[1] : undefined;
	} else {
		const parts = email.split('@');
		fromDomain = parts.length > 1 ? parts[1] : undefined;
	}

	if (fromDomain?.endsWith('>')) {
		fromDomain = fromDomain.slice(0, -1);
	}

	if (!fromDomain) {
		throw new Error('From email is invalid');
	}

	const domain = db
		.select()
		.from(domains)
		.where(and(eq(domains.name, fromDomain), eq(domains.teamId, teamId)))
		.get();

	if (!domain) {
		throw new Error(
			`Domain: ${fromDomain} of from email is wrong. Use the domain verified by Owlery`,
		);
	}

	if (domain.status !== 'SUCCESS') {
		throw new Error(`Domain: ${fromDomain} is not verified`);
	}

	return domain;
}

export async function validateApiKeyDomainAccess(
	email: string,
	teamId: number,
	apiKey: typeof apiKeys.$inferSelect & { domain?: { name: string } | null },
): Promise<Domain> {
	const domain = await validateDomainFromEmail(email, teamId);

	if (!apiKey.domainId) {
		return domain;
	}

	if (apiKey.domainId !== domain.id) {
		throw new Error(`API key does not have access to domain: ${domain.name}`);
	}

	return domain;
}

export async function createDomain(
	teamId: number,
	name: string,
	region: string,
	sesTenantId?: string,
): Promise<DomainWithDnsRecords> {
	const domainStr = tldts.getDomain(name);
	if (!domainStr) {
		throw new Error('Invalid domain');
	}

	const setting = getSetting(region);
	if (!setting) {
		throw new Error('Ses setting not found');
	}

	const { isLimitReached, reason } = await checkDomainLimit(teamId);
	if (isLimitReached) {
		throw new Error(reason ?? 'Domain limit reached');
	}

	const subdomain = tldts.getSubdomain(name) || null;
	const dkimSelector = 'owlery';
	const publicKey = await ses.addDomain(name, region, sesTenantId, dkimSelector);

	const domain = db
		.insert(domains)
		.values({
			name,
			publicKey,
			teamId,
			subdomain,
			region,
			sesTenantId: sesTenantId ?? null,
			dkimSelector,
			dkimStatus: 'NOT_STARTED',
			spfDetails: 'NOT_STARTED',
		})
		.returning()
		.get();

	await emitDomainEvent(domain, 'domain.created');

	return withDnsRecords(domain);
}

/** Lightweight sync list of a team's domains (no DNS records). Ordered by id ASC. */
export function listTeamDomains(teamId: number): Domain[] {
	return db.select().from(domains).where(eq(domains.teamId, teamId)).orderBy(domains.id).all();
}

export async function getDomains(
	teamId: number,
	options?: { domainId?: number },
): Promise<DomainWithDnsRecords[]> {
	const conditions = [eq(domains.teamId, teamId)];
	if (options?.domainId) {
		conditions.push(eq(domains.id, options.domainId));
	}

	const rows = db
		.select()
		.from(domains)
		.where(and(...conditions))
		.orderBy(desc(domains.createdAt))
		.all();

	return rows.map((d) => withDnsRecords(d));
}

export async function getDomain(id: number, teamId: number): Promise<DomainWithDnsRecords> {
	const domain = db
		.select()
		.from(domains)
		.where(and(eq(domains.id, id), eq(domains.teamId, teamId)))
		.get();

	if (!domain) {
		throw new Error('Domain not found');
	}

	if (domain.isVerifying) {
		return refreshDomainVerification(domain);
	}

	return withDnsRecords(domain);
}

export type DomainVerificationRefreshResult = DomainWithDnsRecords & {
	verificationError: string | null;
	lastCheckedTime: string | null;
	previousStatus: DomainStatus;
	statusChanged: boolean;
};

export async function refreshDomainVerification(
	domainOrId: number | Domain,
): Promise<DomainVerificationRefreshResult> {
	const domain =
		typeof domainOrId === 'number'
			? db.select().from(domains).where(eq(domains.id, domainOrId)).get()
			: domainOrId;

	if (!domain) {
		throw new Error('Domain not found');
	}

	const previousStatus = domain.status;
	const domainIdentity = await ses.getDomainIdentity(domain.name, domain.region);

	const dkimStatus = domainIdentity.DkimAttributes?.Status?.toString();
	const spfDetails = domainIdentity.MailFromAttributes?.MailFromDomainStatus?.toString();
	const verificationError = domainIdentity.VerificationInfo?.ErrorType?.toString() ?? null;
	const verificationStatus = parseDomainStatus(domainIdentity.VerificationStatus?.toString());
	const lastCheckedTime = domainIdentity.VerificationInfo?.LastCheckedTimestamp;

	const baseDomain = tldts.getDomain(domain.name);
	const dmarcRecordResult = baseDomain ? await getDmarcRecord(baseDomain) : null;
	const dmarcRecord = dmarcRecordResult?.[0]?.[0];

	const updatedDomain = db
		.update(domains)
		.set({
			dkimStatus: dkimStatus ?? null,
			spfDetails: spfDetails ?? null,
			status: verificationStatus,
			errorMessage: verificationError,
			dmarcAdded: Boolean(dmarcRecord),
			isVerifying: shouldContinueVerifying(verificationStatus, dkimStatus, spfDetails),
		})
		.where(eq(domains.id, domain.id))
		.returning()
		.get();

	const domainWithDns = withDnsRecords(updatedDomain);

	const normalizedLastCheckedTime =
		lastCheckedTime instanceof Date
			? lastCheckedTime.toISOString()
			: lastCheckedTime != null
				? String(lastCheckedTime)
				: null;

	if (previousStatus !== updatedDomain.status) {
		const eventType: DomainWebhookEventType =
			updatedDomain.status === 'SUCCESS' ? 'domain.verified' : 'domain.updated';
		await emitDomainEvent(updatedDomain, eventType);
	}

	return {
		...domainWithDns,
		verificationError,
		lastCheckedTime: normalizedLastCheckedTime,
		previousStatus,
		statusChanged: previousStatus !== updatedDomain.status,
	};
}

export async function updateDomain(
	id: number,
	data: { clickTracking?: boolean; openTracking?: boolean },
): Promise<Domain> {
	const updated = db
		.update(domains)
		.set({
			...(data.clickTracking !== undefined ? { clickTracking: data.clickTracking } : {}),
			...(data.openTracking !== undefined ? { openTracking: data.openTracking } : {}),
		})
		.where(eq(domains.id, id))
		.returning()
		.get();

	await emitDomainEvent(updated, 'domain.updated');

	return updated;
}

export async function deleteDomain(id: number): Promise<Domain> {
	const domain = db.select().from(domains).where(eq(domains.id, id)).get();

	if (!domain) {
		throw new Error('Domain not found');
	}

	const deleted = await ses.deleteDomain(
		domain.name,
		domain.region,
		domain.sesTenantId ?? undefined,
	);

	if (!deleted) {
		throw new Error('Error in deleting domain');
	}

	db.delete(domains).where(eq(domains.id, id)).run();

	await emitDomainEvent(domain, 'domain.deleted');

	return domain;
}
