import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createEmail,
	createSesSetting,
	createDailyUsage,
} from '../../../tests/helpers/factories';
import { emails, emailEvents, queueJobs } from '$lib/server/db/schema';
import { transactionalQueueName } from '../queue/constants';
import { executeEmail, queueEmail } from './email-queue-service';

vi.mock('$lib/server/aws/ses', () => ({
	sendRawEmail: vi.fn(async () => 'ses-message-id-123'),
}));

beforeEach(() => {
	resetDb();
	vi.clearAllMocks();
});

describe('email-queue-service', () => {
	function setup() {
		const team = createTeam();
		createSesSetting({ region: 'us-east-1' });
		const domain = createDomain(team.id, {
			name: 'mail.example.com',
			region: 'us-east-1',
			status: 'SUCCESS',
		});
		const email = createEmail(team.id, {
			from: `noreply@${domain.name}`,
			domainId: domain.id,
			latestStatus: 'QUEUED',
		});
		return { team, domain, email };
	}

	describe('queueEmail', () => {
		it('inserts a queue job for transactional email', () => {
			const { team, email } = setup();

			queueEmail(email.id, team.id, 'us-east-1', true);

			const jobs = db
				.select()
				.from(queueJobs)
				.where(eq(queueJobs.queue, transactionalQueueName('us-east-1')))
				.all();
			expect(jobs.some((j) => j.jobId === email.id)).toBe(true);
		});
	});

	describe('executeEmail', () => {
		it('marks email as SENT on success', async () => {
			const { team, email } = setup();

			await executeEmail({
				emailId: email.id,
				teamId: team.id,
				timestamp: Date.now(),
			});

			const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
			expect(updated?.latestStatus).toBe('SENT');
			expect(updated?.sesEmailId).toBe('ses-message-id-123');
		});

		it('marks email as FAILED when daily limit is reached', async () => {
			const team = createTeam({ dailyEmailLimit: 5 });
			createSesSetting({ region: 'us-east-1' });
			const domain = createDomain(team.id, { region: 'us-east-1', status: 'SUCCESS' });
			const email = createEmail(team.id, { domainId: domain.id, latestStatus: 'QUEUED' });

			createDailyUsage(team.id, domain.id, {
				date: new Date().toISOString().slice(0, 10),
				sent: 5,
			});

			await executeEmail({
				emailId: email.id,
				teamId: team.id,
				timestamp: Date.now(),
			});

			const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
			expect(updated?.latestStatus).toBe('FAILED');

			const events = db.select().from(emailEvents).where(eq(emailEvents.emailId, email.id)).all();
			expect(events.some((e) => e.status === 'FAILED')).toBe(true);
		});

		it('marks email as FAILED when SES send throws', async () => {
			const ses = await import('$lib/server/aws/ses');
			vi.mocked(ses.sendRawEmail).mockRejectedValueOnce(new Error('SES error'));

			const { team, email } = setup();

			await executeEmail({
				emailId: email.id,
				teamId: team.id,
				timestamp: Date.now(),
			});

			const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
			expect(updated?.latestStatus).toBe('FAILED');
		});
	});
});
