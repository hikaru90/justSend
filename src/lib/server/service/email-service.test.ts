import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { cuid, jsonArray, nowIso } from '$lib/utils';
import { resetDb } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createSesSetting,
	createEmail
} from '../../../tests/helpers/factories';
import {
	sendEmail,
	listEmails,
	getEmail,
	cancelEmail,
	updateEmail,
	replaceVariables
} from './email-service';
import { addSuppression } from './suppression-service';
import { db } from '../db';
import { emails, queueJobs } from '../db/schema';
import { transactionalQueueName } from '../queue/constants';

describe('email-service', () => {
	beforeEach(() => resetDb());

	function setupTeamWithDomain() {
		const team = createTeam();
		const domain = createDomain(team.id, { region: 'us-east-1', status: 'SUCCESS' });
		createSesSetting({ region: 'us-east-1' });
		return { team, domain };
	}

	describe('replaceVariables', () => {
		it('replaces placeholders with provided values', () => {
			const result = replaceVariables('Hello {{ name }}, welcome to {{company}}!', {
				name: 'Ada',
				company: 'useSend'
			});

			expect(result).toBe('Hello Ada, welcome to useSend!');
		});
	});

	describe('sendEmail', () => {
		it('queues a transactional email when text or html is provided', async () => {
			const { team, domain } = setupTeamWithDomain();

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'recipient@test.com',
				subject: 'Hello',
				text: 'Plain text body'
			});

			expect(email.latestStatus).toBe('QUEUED');
			expect(email.domainId).toBe(domain.id);

			const job = db
				.select()
				.from(queueJobs)
				.where(
					and(
						eq(queueJobs.queue, transactionalQueueName('us-east-1')),
						eq(queueJobs.jobId, email.id)
					)
				)
				.get();

			expect(job).toBeTruthy();
			expect(job!.status).toBe('pending');
		});

		it('requires text or html content', async () => {
			const { team, domain } = setupTeamWithDomain();

			await expect(
				sendEmail({
					teamId: team.id,
					from: `noreply@${domain.name}`,
					to: 'recipient@test.com',
					subject: 'Empty'
				})
			).rejects.toThrow('Either text or html is required');
		});

		it('records SUPPRESSED when all TO recipients are suppressed', async () => {
			const { team, domain } = setupTeamWithDomain();
			await addSuppression({
				email: 'blocked@test.com',
				teamId: team.id,
				reason: 'MANUAL'
			});

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'blocked@test.com',
				subject: 'Blocked',
				text: 'Should not send'
			});

			expect(email.latestStatus).toBe('SUPPRESSED');

			const jobs = db
				.select()
				.from(queueJobs)
				.where(eq(queueJobs.queue, transactionalQueueName('us-east-1')))
				.all();
			expect(jobs).toHaveLength(0);

			const fetched = getEmail(email.id, team.id);
			expect(fetched.emailEvents.some((e) => e.status === 'SUPPRESSED')).toBe(true);
		});

		it('creates a scheduled email and queue job', async () => {
			const { team, domain } = setupTeamWithDomain();
			const scheduledAt = new Date(Date.now() + 60_000).toISOString();

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'later@test.com',
				subject: 'Scheduled',
				html: '<p>Later</p>',
				scheduledAt
			});

			expect(email.latestStatus).toBe('SCHEDULED');
			expect(email.scheduledAt).toBe(scheduledAt);

			const job = db
				.select()
				.from(queueJobs)
				.where(
					and(
						eq(queueJobs.queue, transactionalQueueName('us-east-1')),
						eq(queueJobs.jobId, email.id),
						eq(queueJobs.status, 'pending')
					)
				)
				.get();
			expect(job).toBeTruthy();
		});
	});

	describe('listEmails', () => {
		it('paginates with cursor', () => {
			const team = createTeam();
			const domain = createDomain(team.id);
			const base = Date.now();

			// Stagger createdAt so sort order aligns with ascending cuid ids.
			for (let i = 0; i < 5; i++) {
				db.insert(emails)
					.values({
						id: cuid(),
						teamId: team.id,
						domainId: domain.id,
						from: `noreply@${domain.name}`,
						to: jsonArray([`user${i}@test.com`]),
						subject: `Email ${i}`,
						html: '<p>Hi</p>',
						latestStatus: 'QUEUED',
						createdAt: new Date(base - (5 - i) * 1000).toISOString(),
						updatedAt: nowIso()
					})
					.run();
			}

			const page1 = listEmails({ teamId: team.id, limit: 2 });
			expect(page1.items).toHaveLength(2);
			expect(page1.nextCursor).toBeTruthy();

			const page2 = listEmails({ teamId: team.id, limit: 2, cursor: page1.nextCursor! });
			expect(page2.items.length).toBeGreaterThanOrEqual(1);
			expect(page2.items.every((e) => e.teamId === team.id)).toBe(true);
		});
	});

	describe('getEmail', () => {
		it('returns email with parsed recipient arrays and events', () => {
			const team = createTeam();
			const domain = createDomain(team.id);
			const created = createEmail(team.id, {
				domainId: domain.id,
				to: ['a@test.com', 'b@test.com']
			});

			const fetched = getEmail(created.id, team.id);

			expect(fetched.to).toEqual(['a@test.com', 'b@test.com']);
			expect(Array.isArray(fetched.emailEvents)).toBe(true);
		});

		it('throws when email is missing', () => {
			const team = createTeam();
			expect(() => getEmail('missing', team.id)).toThrow('Email not found');
		});
	});

	describe('cancelEmail', () => {
		it('cancels a scheduled email and removes its queue job', async () => {
			const { team, domain } = setupTeamWithDomain();
			const scheduledAt = new Date(Date.now() + 120_000).toISOString();

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'cancel@test.com',
				subject: 'Cancel me',
				text: 'Body',
				scheduledAt
			});

			await cancelEmail(email.id);

			const row = db.select().from(emails).where(eq(emails.id, email.id)).get();
			expect(row!.latestStatus).toBe('CANCELLED');

			const job = db
				.select()
				.from(queueJobs)
				.where(
					and(
						eq(queueJobs.queue, transactionalQueueName('us-east-1')),
						eq(queueJobs.jobId, email.id)
					)
				)
				.get();
			expect(job).toBeUndefined();

			const fetched = getEmail(email.id, team.id);
			expect(fetched.emailEvents.some((e) => e.status === 'CANCELLED')).toBe(true);
		});
	});

	describe('updateEmail', () => {
		it('reschedules a pending scheduled email', async () => {
			const { team, domain } = setupTeamWithDomain();
			const originalSchedule = new Date(Date.now() + 120_000).toISOString();

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'reschedule@test.com',
				subject: 'Reschedule me',
				text: 'Body',
				scheduledAt: originalSchedule
			});

			const newSchedule = new Date(Date.now() + 300_000).toISOString();
			await updateEmail(email.id, { scheduledAt: newSchedule });

			const row = db.select().from(emails).where(eq(emails.id, email.id)).get();
			expect(row!.scheduledAt).toBe(newSchedule);

			const job = db
				.select()
				.from(queueJobs)
				.where(
					and(
						eq(queueJobs.queue, transactionalQueueName('us-east-1')),
						eq(queueJobs.jobId, email.id),
						eq(queueJobs.status, 'pending')
					)
				)
				.get();
			expect(job).toBeTruthy();
		});
	});
});
