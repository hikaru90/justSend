import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { cumulatedMetrics, dailyEmailUsages } from '../db/schema';

export type EmailTimeSeriesPoint = {
	date: string;
	sent: number;
	delivered: number;
	opened: number;
	clicked: number;
	bounced: number;
	complained: number;
};

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/**
 * Aggregated daily email metrics for a team over the last `days` days, with
 * missing days filled with zeros.
 */
export function getEmailTimeSeries(input: {
	teamId: number;
	days?: number;
	domainId?: number;
}): { result: EmailTimeSeriesPoint[]; totalCounts: Omit<EmailTimeSeriesPoint, 'date'> } {
	const days = input.days === 7 ? 7 : 30;

	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);
	const isoStartDate = formatDate(startDate);

	const conditions = [
		eq(dailyEmailUsages.teamId, input.teamId),
		gte(dailyEmailUsages.date, isoStartDate)
	];
	if (input.domainId) {
		conditions.push(eq(dailyEmailUsages.domainId, input.domainId));
	}

	const rows = db
		.select({
			date: dailyEmailUsages.date,
			sent: sql<number>`sum(${dailyEmailUsages.sent})`,
			delivered: sql<number>`sum(${dailyEmailUsages.delivered})`,
			opened: sql<number>`sum(${dailyEmailUsages.opened})`,
			clicked: sql<number>`sum(${dailyEmailUsages.clicked})`,
			bounced: sql<number>`sum(${dailyEmailUsages.bounced})`,
			complained: sql<number>`sum(${dailyEmailUsages.complained})`
		})
		.from(dailyEmailUsages)
		.where(and(...conditions))
		.groupBy(dailyEmailUsages.date)
		.orderBy(dailyEmailUsages.date)
		.all();

	const byDate = new Map(rows.map((row) => [row.date, row]));

	const result: EmailTimeSeriesPoint[] = [];
	const endDate = new Date();
	for (let i = days; i > -1; i--) {
		const date = new Date(endDate);
		date.setDate(endDate.getDate() - i);
		const dateStr = formatDate(date);
		const existing = byDate.get(dateStr);
		result.push({
			date: dateStr,
			sent: Number(existing?.sent ?? 0),
			delivered: Number(existing?.delivered ?? 0),
			opened: Number(existing?.opened ?? 0),
			clicked: Number(existing?.clicked ?? 0),
			bounced: Number(existing?.bounced ?? 0),
			complained: Number(existing?.complained ?? 0)
		});
	}

	const totalCounts = result.reduce(
		(acc, curr) => {
			acc.sent += curr.sent;
			acc.delivered += curr.delivered;
			acc.opened += curr.opened;
			acc.clicked += curr.clicked;
			acc.bounced += curr.bounced;
			acc.complained += curr.complained;
			return acc;
		},
		{ sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0 }
	);

	return { result, totalCounts };
}

export type ReputationMetrics = {
	delivered: number;
	hardBounced: number;
	complained: number;
	bounceRate: number;
	complaintRate: number;
};

/**
 * Aggregated reputation metrics (bounce/complaint rates) for a team.
 */
export function getReputationMetrics(input: {
	teamId: number;
	domainId?: number;
}): ReputationMetrics {
	const conditions = [eq(cumulatedMetrics.teamId, input.teamId)];
	if (input.domainId) {
		conditions.push(eq(cumulatedMetrics.domainId, input.domainId));
	}

	const rows = db
		.select()
		.from(cumulatedMetrics)
		.where(and(...conditions))
		.all();

	const totals = rows.reduce(
		(acc, curr) => {
			acc.delivered += Number(curr.delivered);
			acc.hardBounced += Number(curr.hardBounced);
			acc.complained += Number(curr.complained);
			return acc;
		},
		{ delivered: 0, hardBounced: 0, complained: 0 }
	);

	return {
		...totals,
		bounceRate: totals.delivered ? (totals.hardBounced / totals.delivered) * 100 : 0,
		complaintRate: totals.delivered ? (totals.complained / totals.delivered) * 100 : 0
	};
}
