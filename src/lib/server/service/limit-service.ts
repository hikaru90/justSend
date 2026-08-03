import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { contactBooks, dailyEmailUsages, domains, teamUsers, teams, webhooks } from '../db/schema';

export const LimitReason = {
	DOMAIN: 'DOMAIN',
	CONTACT_BOOK: 'CONTACT_BOOK',
	TEAM_MEMBER: 'TEAM_MEMBER',
	WEBHOOK: 'WEBHOOK',
	EMAIL_BLOCKED: 'EMAIL_BLOCKED',
	EMAIL_DAILY_LIMIT_REACHED: 'EMAIL_DAILY_LIMIT_REACHED',
} as const;

export type LimitReason = (typeof LimitReason)[keyof typeof LimitReason];

export type LimitCheckResult = {
	isLimitReached: boolean;
	limit: number;
	reason?: LimitReason;
	available?: number;
};

// Self-hosted limits. No Stripe/cloud gating.
const MAX_DOMAINS = 10;

function isLimitExceeded(current: number, limit: number): boolean {
	if (limit === -1) return false; // unlimited
	return current >= limit;
}

function todayDate(): string {
	return new Date().toISOString().slice(0, 10);
}

export async function checkDomainLimit(teamId: number): Promise<LimitCheckResult> {
	const row = db
		.select({ value: sql<number>`count(*)` })
		.from(domains)
		.where(eq(domains.teamId, teamId))
		.get();
	const currentCount = row?.value ?? 0;

	if (isLimitExceeded(currentCount, MAX_DOMAINS)) {
		return { isLimitReached: true, limit: MAX_DOMAINS, reason: LimitReason.DOMAIN };
	}

	return { isLimitReached: false, limit: MAX_DOMAINS };
}

export async function checkContactBookLimit(teamId: number): Promise<LimitCheckResult> {
	// Unlimited on self-hosted.
	void teamId;
	void contactBooks;
	return { isLimitReached: false, limit: -1 };
}

export async function checkTeamMemberLimit(teamId: number): Promise<LimitCheckResult> {
	// Unlimited on self-hosted.
	void teamId;
	void teamUsers;
	return { isLimitReached: false, limit: -1 };
}

export async function checkWebhookLimit(teamId: number): Promise<LimitCheckResult> {
	// Unlimited on self-hosted.
	void teamId;
	void webhooks;
	return { isLimitReached: false, limit: -1 };
}

export async function checkEmailLimit(teamId: number): Promise<LimitCheckResult> {
	const team = db.select().from(teams).where(eq(teams.id, teamId)).get();

	if (!team) {
		return { isLimitReached: true, limit: 0, reason: LimitReason.EMAIL_BLOCKED };
	}

	if (team.isBlocked) {
		return { isLimitReached: true, limit: 0, reason: LimitReason.EMAIL_BLOCKED };
	}

	const dailyLimit = team.dailyEmailLimit;

	const usageRow = db
		.select({ value: sql<number>`coalesce(sum(${dailyEmailUsages.sent}), 0)` })
		.from(dailyEmailUsages)
		.where(and(eq(dailyEmailUsages.teamId, teamId), eq(dailyEmailUsages.date, todayDate())))
		.get();
	const dailyUsage = usageRow?.value ?? 0;

	if (isLimitExceeded(dailyUsage, dailyLimit)) {
		return {
			isLimitReached: true,
			limit: dailyLimit,
			reason: LimitReason.EMAIL_DAILY_LIMIT_REACHED,
			available: dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - dailyUsage),
		};
	}

	return {
		isLimitReached: false,
		limit: dailyLimit,
		available: dailyLimit === -1 ? -1 : Math.max(0, dailyLimit - dailyUsage),
	};
}
