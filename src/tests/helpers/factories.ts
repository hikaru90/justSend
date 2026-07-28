import { cuid, jsonArray, nowIso } from '$lib/utils';
import { db } from '$lib/server/db';
import {
	users,
	teams,
	teamUsers,
	domains,
	emails,
	contactBooks,
	contacts,
	campaigns,
	templates,
	webhooks,
	sessions,
	sesSettings,
	dailyEmailUsages,
	cumulatedMetrics,
	type ApiPermission,
	type DomainStatus,
	type EmailStatus,
	type Role,
	type CampaignStatus
} from '$lib/server/db/schema';
import { addApiKey } from '$lib/server/service/api-service';

let counter = 0;
function next() {
	return ++counter;
}

export function createUser(overrides: Partial<{ name: string; email: string }> = {}) {
	const n = next();
	return db
		.insert(users)
		.values({
			name: overrides.name ?? `User ${n}`,
			email: overrides.email ?? `user${n}@example.com`,
			emailVerified: nowIso()
		})
		.returning()
		.get();
}

export function createTeam(overrides: Partial<{ name: string; dailyEmailLimit: number; isBlocked: boolean }> = {}) {
	return db
		.insert(teams)
		.values({
			name: overrides.name ?? `Team ${next()}`,
			dailyEmailLimit: overrides.dailyEmailLimit ?? 10000,
			isBlocked: overrides.isBlocked ?? false,
			isVerified: true
		})
		.returning()
		.get();
}

export function addUserToTeam(teamId: number, userId: number, role: Role = 'ADMIN') {
	db.insert(teamUsers).values({ teamId, userId, role }).run();
	return { teamId, userId, role };
}

export function createDomain(
	teamId: number,
	overrides: Partial<{
		name: string;
		status: DomainStatus;
		region: string;
		clickTracking: boolean;
		openTracking: boolean;
		isVerifying: boolean;
	}> = {}
) {
	const n = next();
	return db
		.insert(domains)
		.values({
			name: overrides.name ?? `mail${n}.example.com`,
			teamId,
			status: overrides.status ?? 'SUCCESS',
			region: overrides.region ?? 'us-east-1',
			publicKey: 'test-public-key',
			dkimSelector: 'justsend',
			clickTracking: overrides.clickTracking ?? false,
			openTracking: overrides.openTracking ?? false,
			isVerifying: overrides.isVerifying ?? false
		})
		.returning()
		.get();
}

export async function createApiKey(
	teamId: number,
	overrides: Partial<{ name: string; permission: ApiPermission; domainId: number }> = {}
) {
	const token = await addApiKey({
		name: overrides.name ?? `Key ${next()}`,
		permission: overrides.permission ?? 'FULL',
		teamId,
		domainId: overrides.domainId
	});
	return token;
}

export function createContactBook(
	teamId: number,
	overrides: Partial<{
		name: string;
		doubleOptInEnabled: boolean;
		doubleOptInFrom: string | null;
		doubleOptInSubject: string | null;
		doubleOptInContent: string | null;
	}> = {}
) {
	return db
		.insert(contactBooks)
		.values({
			id: cuid(),
			name: overrides.name ?? `Book ${next()}`,
			teamId,
			variables: '[]',
			properties: '{}',
			doubleOptInEnabled: overrides.doubleOptInEnabled ?? false,
			doubleOptInFrom: overrides.doubleOptInFrom ?? null,
			doubleOptInSubject: overrides.doubleOptInSubject ?? null,
			doubleOptInContent: overrides.doubleOptInContent ?? null
		})
		.returning()
		.get();
}

export function createContact(
	contactBookId: string,
	overrides: Partial<{
		email: string;
		firstName: string;
		lastName: string;
		subscribed: boolean;
		unsubscribeReason: 'BOUNCED' | 'COMPLAINED' | 'UNSUBSCRIBED' | null;
		properties: Record<string, unknown>;
	}> = {}
) {
	const n = next();
	return db
		.insert(contacts)
		.values({
			id: cuid(),
			contactBookId,
			email: overrides.email ?? `contact${n}@example.com`,
			firstName: overrides.firstName ?? null,
			lastName: overrides.lastName ?? null,
			subscribed: overrides.subscribed ?? true,
			unsubscribeReason: overrides.unsubscribeReason ?? null,
			properties: JSON.stringify(overrides.properties ?? {})
		})
		.returning()
		.get();
}

export function createCampaign(
	teamId: number,
	domainId: number,
	overrides: Partial<{
		name: string;
		from: string;
		subject: string;
		html: string;
		status: CampaignStatus;
		contactBookId: string | null;
		scheduledAt: string | null;
	}> = {}
) {
	const n = next();
	return db
		.insert(campaigns)
		.values({
			id: cuid(),
			name: overrides.name ?? `Campaign ${n}`,
			teamId,
			domainId,
			from: overrides.from ?? `noreply@mail${n}.example.com`,
			subject: overrides.subject ?? `Subject ${n}`,
			html:
				overrides.html ??
				`<p>Hello</p><a href="{{justsend_unsubscribe_url}}">Unsubscribe</a>`,
			status: overrides.status ?? 'DRAFT',
			contactBookId: overrides.contactBookId ?? null,
			scheduledAt: overrides.scheduledAt ?? null
		})
		.returning()
		.get();
}

export function createTemplate(
	teamId: number,
	overrides: Partial<{ name: string; subject: string; html: string }> = {}
) {
	const n = next();
	return db
		.insert(templates)
		.values({
			id: cuid(),
			teamId,
			name: overrides.name ?? `Template ${n}`,
			subject: overrides.subject ?? `Hello {{name}}`,
			html: overrides.html ?? `<p>Hi {{name}}</p>`
		})
		.returning()
		.get();
}

export function createWebhook(
	teamId: number,
	overrides: Partial<{
		url: string;
		secret: string;
		status: 'ACTIVE' | 'PAUSED' | 'AUTO_DISABLED';
		eventTypes: string[];
		domainIds: number[];
	}> = {}
) {
	return db
		.insert(webhooks)
		.values({
			id: cuid(),
			teamId,
			url: overrides.url ?? 'https://example.com/webhook',
			secret: overrides.secret ?? 'whsec_testsecret',
			status: overrides.status ?? 'ACTIVE',
			eventTypes: jsonArray(overrides.eventTypes ?? ['email.delivered']),
			domainIds: jsonArray((overrides.domainIds ?? []).map(String))
		})
		.returning()
		.get();
}

export function createSession(userId: number, overrides: Partial<{ sessionToken: string; expires: string }> = {}) {
	const token = overrides.sessionToken ?? cuid();
	const expires =
		overrides.expires ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
	return db
		.insert(sessions)
		.values({
			id: cuid(),
			sessionToken: token,
			userId,
			expires
		})
		.returning()
		.get();
}

export function createEmail(
	teamId: number,
	overrides: Partial<{
		from: string;
		to: string[];
		subject: string;
		html: string;
		text: string;
		latestStatus: EmailStatus;
		domainId: number;
		sesEmailId: string | null;
		scheduledAt: string | null;
		campaignId: string | null;
		contactId: string | null;
	}> = {}
) {
	const n = next();
	return db
		.insert(emails)
		.values({
			id: cuid(),
			teamId,
			from: overrides.from ?? `noreply@example.com`,
			to: jsonArray(overrides.to ?? [`to${n}@example.com`]),
			subject: overrides.subject ?? `Subject ${n}`,
			html: overrides.html ?? '<p>Hi</p>',
			text: overrides.text ?? null,
			latestStatus: overrides.latestStatus ?? 'QUEUED',
			domainId: overrides.domainId ?? null,
			sesEmailId: overrides.sesEmailId ?? null,
			scheduledAt: overrides.scheduledAt ?? null,
			campaignId: overrides.campaignId ?? null,
			contactId: overrides.contactId ?? null
		})
		.returning()
		.get();
}

export function createSesSetting(
	overrides: Partial<{
		region: string;
		idPrefix: string;
		topic: string;
		topicArn: string;
		callbackUrl: string;
		callbackSuccess: boolean;
		configGeneral: string;
		configGeneralSuccess: boolean;
		configFull: string;
		configFullSuccess: boolean;
		sesEmailRateLimit: number;
		transactionalQuota: number;
	}> = {}
) {
	const n = next();
	return db
		.insert(sesSettings)
		.values({
			id: cuid(),
			region: overrides.region ?? 'us-east-1',
			idPrefix: overrides.idPrefix ?? `us${n}`,
			topic: overrides.topic ?? `justsend-${n}`,
			topicArn: overrides.topicArn ?? `arn:aws:sns:us-east-1:123:justsend-${n}`,
			callbackUrl: overrides.callbackUrl ?? 'http://localhost:5173/api/ses_callback',
			callbackSuccess: overrides.callbackSuccess ?? true,
			configGeneral: overrides.configGeneral ?? 'justsend-general',
			configGeneralSuccess: overrides.configGeneralSuccess ?? true,
			configFull: overrides.configFull ?? 'justsend-full',
			configFullSuccess: overrides.configFullSuccess ?? true,
			sesEmailRateLimit: overrides.sesEmailRateLimit ?? 10,
			transactionalQuota: overrides.transactionalQuota ?? 50
		})
		.returning()
		.get();
}

export function createDailyUsage(
	teamId: number,
	domainId: number,
	overrides: Partial<{
		date: string;
		type: 'TRANSACTIONAL' | 'MARKETING';
		sent: number;
		delivered: number;
		opened: number;
		clicked: number;
		bounced: number;
		complained: number;
		hardBounced: number;
	}> = {}
) {
	return db
		.insert(dailyEmailUsages)
		.values({
			teamId,
			domainId,
			date: overrides.date ?? new Date().toISOString().slice(0, 10),
			type: overrides.type ?? 'TRANSACTIONAL',
			sent: overrides.sent ?? 0,
			delivered: overrides.delivered ?? 0,
			opened: overrides.opened ?? 0,
			clicked: overrides.clicked ?? 0,
			bounced: overrides.bounced ?? 0,
			complained: overrides.complained ?? 0,
			hardBounced: overrides.hardBounced ?? 0
		})
		.returning()
		.get();
}

export function createCumulatedMetrics(
	teamId: number,
	domainId: number,
	overrides: Partial<{ delivered: number; hardBounced: number; complained: number }> = {}
) {
	return db
		.insert(cumulatedMetrics)
		.values({
			teamId,
			domainId,
			delivered: overrides.delivered ?? 100,
			hardBounced: overrides.hardBounced ?? 1,
			complained: overrides.complained ?? 0
		})
		.returning()
		.get();
}

/** Convenience: team + verified domain + FULL API key */
export async function createTeamWithApiKey(
	opts: Partial<{ teamName: string; domainName: string; permission: ApiPermission }> = {}
) {
	const team = createTeam({ name: opts.teamName });
	const domain = createDomain(team.id, {
		name: opts.domainName ?? `mail${next()}.example.com`,
		status: 'SUCCESS'
	});
	const apiKey = await createApiKey(team.id, { permission: opts.permission ?? 'FULL' });
	return { team, domain, apiKey };
}
