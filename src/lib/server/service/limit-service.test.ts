import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createContactBook,
	createWebhook,
	createUser,
	addUserToTeam,
	createDailyUsage
} from '../../../tests/helpers/factories';
import {
	checkDomainLimit,
	checkContactBookLimit,
	checkTeamMemberLimit,
	checkWebhookLimit,
	checkEmailLimit,
	LimitReason
} from './limit-service';

describe('limit-service', () => {
	beforeEach(() => resetDb());

	describe('checkDomainLimit', () => {
		it('allows teams under the domain cap', async () => {
			const team = createTeam();
			for (let i = 0; i < 9; i++) {
				createDomain(team.id);
			}

			const result = await checkDomainLimit(team.id);

			expect(result.isLimitReached).toBe(false);
			expect(result.limit).toBe(10);
		});

		it('blocks teams at the domain cap', async () => {
			const team = createTeam();
			for (let i = 0; i < 10; i++) {
				createDomain(team.id);
			}

			const result = await checkDomainLimit(team.id);

			expect(result.isLimitReached).toBe(true);
			expect(result.limit).toBe(10);
			expect(result.reason).toBe(LimitReason.DOMAIN);
		});
	});

	describe('unlimited self-hosted limits', () => {
		it('checkContactBookLimit is unlimited', async () => {
			const team = createTeam();
			createContactBook(team.id);
			createContactBook(team.id);

			const result = await checkContactBookLimit(team.id);

			expect(result.isLimitReached).toBe(false);
			expect(result.limit).toBe(-1);
		});

		it('checkTeamMemberLimit is unlimited', async () => {
			const team = createTeam();
			const user = createUser();
			addUserToTeam(team.id, user.id);

			const result = await checkTeamMemberLimit(team.id);

			expect(result.isLimitReached).toBe(false);
			expect(result.limit).toBe(-1);
		});

		it('checkWebhookLimit is unlimited', async () => {
			const team = createTeam();
			createWebhook(team.id);

			const result = await checkWebhookLimit(team.id);

			expect(result.isLimitReached).toBe(false);
			expect(result.limit).toBe(-1);
		});
	});

	describe('checkEmailLimit', () => {
		it('blocks a missing team', async () => {
			const result = await checkEmailLimit(99999);

			expect(result.isLimitReached).toBe(true);
			expect(result.reason).toBe(LimitReason.EMAIL_BLOCKED);
		});

		it('blocks a blocked team', async () => {
			const team = createTeam({ isBlocked: true });

			const result = await checkEmailLimit(team.id);

			expect(result.isLimitReached).toBe(true);
			expect(result.reason).toBe(LimitReason.EMAIL_BLOCKED);
		});

		it('blocks when daily limit is reached', async () => {
			const team = createTeam({ dailyEmailLimit: 100 });
			const domain = createDomain(team.id);
			const today = new Date().toISOString().slice(0, 10);
			createDailyUsage(team.id, domain.id, { date: today, sent: 100 });

			const result = await checkEmailLimit(team.id);

			expect(result.isLimitReached).toBe(true);
			expect(result.reason).toBe(LimitReason.EMAIL_DAILY_LIMIT_REACHED);
			expect(result.limit).toBe(100);
			expect(result.available).toBe(0);
		});

		it('allows unlimited daily sending when limit is -1', async () => {
			const team = createTeam({ dailyEmailLimit: -1 });
			const domain = createDomain(team.id);
			const today = new Date().toISOString().slice(0, 10);
			createDailyUsage(team.id, domain.id, { date: today, sent: 1_000_000 });

			const result = await checkEmailLimit(team.id);

			expect(result.isLimitReached).toBe(false);
			expect(result.limit).toBe(-1);
			expect(result.available).toBe(-1);
		});
	});
});
