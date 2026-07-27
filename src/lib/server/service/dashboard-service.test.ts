import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createDailyUsage,
	createCumulatedMetrics
} from '../../../tests/helpers/factories';
import { getEmailTimeSeries, getReputationMetrics } from './dashboard-service';

beforeEach(() => resetDb());

function daysAgo(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return d.toISOString().slice(0, 10);
}

describe('dashboard-service', () => {
	describe('getEmailTimeSeries', () => {
		it('returns 8 data points for 7 days with missing days filled with zeros', () => {
			const team = createTeam();
			const domain = createDomain(team.id);

			createDailyUsage(team.id, domain.id, {
				date: daysAgo(3),
				sent: 10,
				delivered: 8,
				opened: 2,
				clicked: 1,
				bounced: 0,
				complained: 0
			});

			const { result, totalCounts } = getEmailTimeSeries({ teamId: team.id, days: 7 });

			expect(result).toHaveLength(8);
			expect(totalCounts.sent).toBe(10);
			expect(totalCounts.delivered).toBe(8);

			const dayWithData = result.find((p) => p.sent === 10);
			expect(dayWithData).toBeDefined();

			const zeroDays = result.filter((p) => p.sent === 0);
			expect(zeroDays.length).toBeGreaterThan(0);
		});

		it('returns 31 data points for 30 days', () => {
			const team = createTeam();
			const domain = createDomain(team.id);

			createDailyUsage(team.id, domain.id, {
				date: daysAgo(15),
				sent: 5,
				delivered: 5
			});

			const { result } = getEmailTimeSeries({ teamId: team.id, days: 30 });
			expect(result).toHaveLength(31);
		});

		it('filters by domainId when provided', () => {
			const team = createTeam();
			const domain1 = createDomain(team.id, { name: 'a.example.com' });
			const domain2 = createDomain(team.id, { name: 'b.example.com' });

			createDailyUsage(team.id, domain1.id, { date: daysAgo(1), sent: 20 });
			createDailyUsage(team.id, domain2.id, { date: daysAgo(1), sent: 50 });

			const { totalCounts } = getEmailTimeSeries({
				teamId: team.id,
				days: 7,
				domainId: domain1.id
			});
			expect(totalCounts.sent).toBe(20);
		});
	});

	describe('getReputationMetrics', () => {
		it('aggregates cumulated metrics and computes rates', () => {
			const team = createTeam();
			const domain1 = createDomain(team.id, { name: 'd1.example.com' });
			const domain2 = createDomain(team.id, { name: 'd2.example.com' });

			createCumulatedMetrics(team.id, domain1.id, {
				delivered: 100,
				hardBounced: 2,
				complained: 1
			});
			createCumulatedMetrics(team.id, domain2.id, {
				delivered: 200,
				hardBounced: 4,
				complained: 2
			});

			const metrics = getReputationMetrics({ teamId: team.id });
			expect(metrics.delivered).toBe(300);
			expect(metrics.hardBounced).toBe(6);
			expect(metrics.complained).toBe(3);
			expect(metrics.bounceRate).toBeCloseTo(2, 5);
			expect(metrics.complaintRate).toBeCloseTo(1, 5);
		});

		it('returns zero rates when no deliveries', () => {
			const team = createTeam();
			const domain = createDomain(team.id);
			createCumulatedMetrics(team.id, domain.id, {
				delivered: 0,
				hardBounced: 0,
				complained: 0
			});

			const metrics = getReputationMetrics({ teamId: team.id });
			expect(metrics.bounceRate).toBe(0);
			expect(metrics.complaintRate).toBe(0);
		});
	});
});
