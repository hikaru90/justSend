import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { cuid, jsonArray, nowIso } from '$lib/utils';
import { resetDb } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createSesSetting,
	createEmail,
	createTemplate,
} from '../../../tests/helpers/factories';
import {
	sendEmail,
	listEmails,
	getEmail,
	cancelEmail,
	updateEmail,
	replaceVariables,
} from './email-service';
import { renderTemplateForSend } from './render-template-for-send';
import { addSuppression } from './suppression-service';
import { db } from '../db';
import { emails, queueJobs } from '../db/schema';
import { transactionalQueueName } from '../queue/constants';
import { emptyOwlDoc, newSectionId, serializeOwlDoc } from '$lib/email/owl/studio';

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
				company: 'Owlery',
			});

			expect(result).toBe('Hello Ada, welcome to Owlery!');
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
				text: 'Plain text body',
			});

			expect(email.latestStatus).toBe('QUEUED');
			expect(email.domainId).toBe(domain.id);

			const job = db
				.select()
				.from(queueJobs)
				.where(
					and(
						eq(queueJobs.queue, transactionalQueueName('us-east-1')),
						eq(queueJobs.jobId, email.id),
					),
				)
				.get();

			expect(job).toBeTruthy();
			expect(job!.status).toBe('pending');
		});

		it('rewrites relative design-asset URLs to absolute HOST_URL paths', async () => {
			const { team, domain } = setupTeamWithDomain();

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'recipient@test.com',
				subject: 'With image',
				html: '<img src="/api/design-asset/asset_abc" alt="logo" />',
			});

			expect(email.html).toContain('src="http://localhost:5173/api/design-asset/asset_abc"');
		});

		it('rewrites localhost design-asset URLs onto HOST_URL', async () => {
			const { team, domain } = setupTeamWithDomain();

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'recipient@test.com',
				subject: 'With image',
				html: '<img src="http://127.0.0.1:9999/api/design-asset/asset_abc" alt="logo" />',
				assetBaseUrl: 'https://send.example.com',
			});

			expect(email.html).toContain('src="https://send.example.com/api/design-asset/asset_abc"');
			expect(email.html).not.toContain('127.0.0.1');
		});

		it('requires text or html content', async () => {
			const { team, domain } = setupTeamWithDomain();

			await expect(
				sendEmail({
					teamId: team.id,
					from: `noreply@${domain.name}`,
					to: 'recipient@test.com',
					subject: 'Empty',
				}),
			).rejects.toThrow('Either text or html is required');
		});

		it('records SUPPRESSED when all TO recipients are suppressed', async () => {
			const { team, domain } = setupTeamWithDomain();
			await addSuppression({
				email: 'blocked@test.com',
				teamId: team.id,
				reason: 'MANUAL',
			});

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'blocked@test.com',
				subject: 'Blocked',
				text: 'Should not send',
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

		it('compiles from the stored OwlDoc instead of trusting stale cached HTML', async () => {
			const { team, domain } = setupTeamWithDomain();

			const SHELL = `<!DOCTYPE html><html><head></head><body>
<div data-owl-preheader>Preheader</div>
<!--owl:sections-->
</body></html>`;
			const doc = emptyOwlDoc(SHELL, 'Preheader');
			doc.sections.push({
				id: newSectionId(),
				key: 'text',
				label: 'Text',
				html: '<p data-owl-slot="body" data-owl-slot-type="text">stale</p>',
			});
			doc.slotValues = { body: 'Light logo copy' };

			// The cached snapshot still carries the OLD (dark) copy, while the
			// OwlDoc (source of truth) has the current (light) copy.
			const template = createTemplate(team.id, {
				name: 'drift',
				subject: 'Drift check',
				content: serializeOwlDoc(doc),
				html: '<p>DARK-STALE</p>',
			});

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'light@test.com',
				subject: 'Unused',
				templateId: template.id,
			});

			expect(email.html).toContain('Light logo copy');
			expect(email.html).not.toContain('DARK-STALE');
		});

		it('renderTemplateForSend falls back to cached HTML for legacy templates', async () => {
			const html = await renderTemplateForSend(
				{ content: null, html: '<p>Hi {{name}}</p>' },
				{ variables: { name: 'Ada' } },
			);
			expect(html).toBe('<p>Hi Ada</p>');
		});

		it('substitutes variables into direct html/subject sends without templateId', async () => {
			const { team, domain } = setupTeamWithDomain();

			const email = await sendEmail({
				teamId: team.id,
				from: `noreply@${domain.name}`,
				to: 'recipient@test.com',
				subject: 'Hi {{firstName}}',
				html: '<p>Hello {{firstName}} {{lastName}}</p>',
				variables: { firstName: 'Alex', lastName: 'River' },
			});

			expect(email.subject).toBe('Hi Alex');
			expect(email.html).toBe('<p>Hello Alex River</p>');
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
				scheduledAt,
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
						eq(queueJobs.status, 'pending'),
					),
				)
				.get();
			expect(job).toBeTruthy();
		});
	});

	describe('listEmails', () => {
		it('paginates with cursor', () => {
			const team = createTeam();
			const domain = createDomain(team.id);

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
						createdAt: nowIso(),
						updatedAt: nowIso(),
					})
					.run();
			}

			const page1 = listEmails({ teamId: team.id, limit: 2 });
			expect(page1.items).toHaveLength(2);
			expect(page1.nextCursor).toBeTruthy();
			expect(page1.nextCursor).toBe(page1.items[1]!.id);

			const page2 = listEmails({ teamId: team.id, limit: 2, cursor: page1.nextCursor! });
			expect(page2.items).toHaveLength(2);
			expect(page2.items.every((e) => e.teamId === team.id)).toBe(true);
			expect(page2.items.every((e) => e.id < page1.nextCursor!)).toBe(true);

			const page3 = listEmails({ teamId: team.id, limit: 2, cursor: page2.nextCursor! });
			expect(page3.items).toHaveLength(1);
			expect(page3.nextCursor).toBeNull();
		});
	});

	describe('getEmail', () => {
		it('returns email with parsed recipient arrays and events', () => {
			const team = createTeam();
			const domain = createDomain(team.id);
			const created = createEmail(team.id, {
				domainId: domain.id,
				to: ['a@test.com', 'b@test.com'],
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
				scheduledAt,
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
						eq(queueJobs.jobId, email.id),
					),
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
				scheduledAt: originalSchedule,
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
						eq(queueJobs.status, 'pending'),
					),
				)
				.get();
			expect(job).toBeTruthy();
		});
	});
});
