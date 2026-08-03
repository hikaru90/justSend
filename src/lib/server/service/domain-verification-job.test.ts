import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db } from '../../../tests/helpers/db';
import { createTeam, createDomain } from '../../../tests/helpers/factories';
import { domains, queueJobs } from '$lib/server/db/schema';
import { QUEUES } from '../queue/constants';

vi.mock('$lib/server/aws/ses', () => ({
	getDomainIdentity: vi.fn(async () => ({
		VerificationStatus: 'SUCCESS',
		DkimAttributes: { Status: 'SUCCESS', Tokens: [] },
		MailFromAttributes: { MailFromDomainStatus: 'SUCCESS' },
	})),
}));

beforeEach(() => {
	resetDb();
	vi.clearAllMocks();
});

describe('domain-verification-job', () => {
	describe('queueDomainVerification', () => {
		it('enqueues a domain verification job', async () => {
			const { queueDomainVerification } = await import('./domain-verification-job');
			const team = createTeam();
			const domain = createDomain(team.id, { status: 'PENDING', isVerifying: true });

			queueDomainVerification(domain.id);

			const jobs = db
				.select()
				.from(queueJobs)
				.where(eq(queueJobs.queue, QUEUES.DOMAIN_VERIFICATION))
				.all();
			expect(jobs.length).toBeGreaterThan(0);
			expect(JSON.parse(jobs[0].payload)).toEqual({ domainId: domain.id });
		});
	});

	describe('processDomainVerification', () => {
		it('refreshes verification status for a pending domain', async () => {
			const { processDomainVerification } = await import('./domain-verification-job');
			const team = createTeam();
			const domain = createDomain(team.id, {
				name: 'pending.example.com',
				status: 'PENDING',
				isVerifying: true,
			});

			await processDomainVerification({ domainId: domain.id });

			const updated = db.select().from(domains).where(eq(domains.id, domain.id)).get();
			expect(updated?.status).toBe('SUCCESS');
		});

		it('processes all pending domains when no domainId is given', async () => {
			const { processDomainVerification } = await import('./domain-verification-job');
			const team = createTeam();
			const d1 = createDomain(team.id, {
				name: 'a.example.com',
				status: 'PENDING',
				isVerifying: true,
			});
			const d2 = createDomain(team.id, {
				name: 'b.example.com',
				status: 'PENDING',
				isVerifying: true,
			});

			await processDomainVerification({});

			expect(db.select().from(domains).where(eq(domains.id, d1.id)).get()?.status).toBe('SUCCESS');
			expect(db.select().from(domains).where(eq(domains.id, d2.id)).get()?.status).toBe('SUCCESS');
		});
	});
});
