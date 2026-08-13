import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm';
import { cuid, nowIso } from '$lib/utils';
import { db } from '../db';
import { domains, suppressionList, type SuppressionReason } from '../db/schema';
import { deleteFromSesSuppressionList } from '../aws/ses';

export type Suppression = typeof suppressionList.$inferSelect;

export type AddSuppressionParams = {
	email: string;
	teamId: number;
	domainId?: number | null;
	reason: SuppressionReason;
	source?: string;
};

export type GetSuppressionListParams = {
	teamId: number;
	domainId?: number;
	page?: number;
	limit?: number;
	search?: string;
	reason?: SuppressionReason | null;
	sortBy?: 'email' | 'reason' | 'createdAt';
	sortOrder?: 'asc' | 'desc';
};

export type SuppressionListResult = {
	suppressions: Suppression[];
	total: number;
};

export async function addSuppression(params: AddSuppressionParams): Promise<Suppression> {
	const { teamId, domainId, reason, source } = params;
	const email = params.email.toLowerCase().trim();

	return db
		.insert(suppressionList)
		.values({
			id: cuid(),
			email,
			teamId,
			domainId: domainId ?? null,
			reason,
			source: source ?? null,
		})
		.onConflictDoUpdate({
			target: [suppressionList.teamId, suppressionList.email],
			set: {
				reason,
				...(domainId !== undefined ? { domainId: domainId ?? null } : {}),
				source: source ?? null,
				updatedAt: nowIso(),
			},
		})
		.returning()
		.get();
}

export async function isEmailSuppressed(
	email: string,
	teamId: number,
	domainId?: number,
): Promise<boolean> {
	const normalizedEmail = email.toLowerCase().trim();
	const conditions = [
		eq(suppressionList.teamId, teamId),
		eq(suppressionList.email, normalizedEmail),
	];
	if (domainId !== undefined) {
		conditions.push(eq(suppressionList.domainId, domainId));
	}
	const suppression = db
		.select({ id: suppressionList.id })
		.from(suppressionList)
		.where(and(...conditions))
		.get();

	return Boolean(suppression);
}

export async function removeSuppression(email: string, teamId: number): Promise<void> {
	const normalizedEmail = email.toLowerCase().trim();

	// Best-effort cleanup from AWS SES suppression list across the team's regions.
	try {
		const teamDomains = db
			.select({ region: domains.region })
			.from(domains)
			.where(eq(domains.teamId, teamId))
			.all();

		const uniqueRegions = [...new Set(teamDomains.map((d) => d.region))];
		if (uniqueRegions.length > 0) {
			await Promise.allSettled(
				uniqueRegions.map((region) => deleteFromSesSuppressionList(normalizedEmail, region)),
			);
		}
	} catch (error) {
		console.error('[suppression] Failed AWS SES cleanup (continuing with local deletion)', error);
	}

	db.delete(suppressionList)
		.where(and(eq(suppressionList.teamId, teamId), eq(suppressionList.email, normalizedEmail)))
		.run();
}

export async function checkMultipleEmails(
	emails: string[],
	teamId: number,
): Promise<Record<string, boolean>> {
	const normalizedEmails = emails.map((email) => email.toLowerCase().trim());

	const suppressions =
		normalizedEmails.length > 0
			? db
					.select({ email: suppressionList.email })
					.from(suppressionList)
					.where(
						and(
							eq(suppressionList.teamId, teamId),
							inArray(suppressionList.email, normalizedEmails),
						),
					)
					.all()
			: [];

	const suppressedEmails = new Set(suppressions.map((s) => s.email));

	const result: Record<string, boolean> = {};
	for (const email of emails) {
		result[email] = suppressedEmails.has(email.toLowerCase().trim());
	}
	return result;
}

export async function getSuppressionList(
	params: GetSuppressionListParams,
): Promise<SuppressionListResult> {
	const {
		teamId,
		domainId,
		page = 1,
		limit = 20,
		search,
		reason,
		sortBy = 'createdAt',
		sortOrder = 'desc',
	} = params;

	const offset = (page - 1) * limit;

	const conditions = [eq(suppressionList.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(suppressionList.domainId, domainId));
	}
	if (search) {
		conditions.push(like(suppressionList.email, `%${search}%`));
	}
	if (reason) {
		conditions.push(eq(suppressionList.reason, reason));
	}
	const where = and(...conditions);

	const sortColumn =
		sortBy === 'email'
			? suppressionList.email
			: sortBy === 'reason'
				? suppressionList.reason
				: suppressionList.createdAt;
	const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

	const suppressions = db
		.select()
		.from(suppressionList)
		.where(where)
		.orderBy(orderBy)
		.limit(limit)
		.offset(offset)
		.all();

	const totalRow = db.select({ value: count() }).from(suppressionList).where(where).get();

	return {
		suppressions,
		total: totalRow?.value ?? 0,
	};
}

export async function addMultipleSuppressions(
	teamId: number,
	emails: string[],
	reason: SuppressionReason,
	domainId?: number,
): Promise<void> {
	const normalizedEmails = emails.map((email) => email.toLowerCase().trim());
	const uniqueEmails = Array.from(new Set(normalizedEmails));

	const batchSize = 1000;
	for (let i = 0; i < uniqueEmails.length; i += batchSize) {
		const batch = uniqueEmails.slice(i, i + batchSize);
		if (batch.length === 0) continue;

		db.insert(suppressionList)
			.values(
				batch.map((email) => ({
					id: cuid(),
					teamId,
					domainId: domainId ?? null,
					email,
					reason,
				})),
			)
			.onConflictDoNothing({
				target: [suppressionList.teamId, suppressionList.email],
			})
			.run();
	}
}

export async function getSuppressionStats(
	teamId: number,
	domainId?: number,
): Promise<Record<SuppressionReason, number>> {
	const conditions = [eq(suppressionList.teamId, teamId)];
	if (domainId !== undefined) {
		conditions.push(eq(suppressionList.domainId, domainId));
	}

	const rows = db
		.select({ reason: suppressionList.reason, value: count() })
		.from(suppressionList)
		.where(and(...conditions))
		.groupBy(suppressionList.reason)
		.all();

	const result: Record<SuppressionReason, number> = {
		HARD_BOUNCE: 0,
		COMPLAINT: 0,
		MANUAL: 0,
	};

	for (const row of rows) {
		result[row.reason] = row.value;
	}

	return result;
}
