import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createUser,
	addUserToTeam,
} from '../../../tests/helpers/factories';
import { queueJobs, webhookCalls } from '$lib/server/db/schema';
import { QUEUES } from '../queue/constants';
import {
	createWebhook,
	deleteWebhook,
	emit,
	generateSecret,
	getWebhook,
	listWebhooks,
	processWebhookCall,
	retryCall,
	setWebhookStatus,
	testWebhook,
	updateWebhook,
} from './webhook-service';

beforeEach(() => {
	resetDb();
	vi.restoreAllMocks();
});

describe('webhook-service', () => {
	function setup() {
		const team = createTeam();
		const user = createUser();
		addUserToTeam(team.id, user.id);
		const domain = createDomain(team.id);
		return { team, user, domain };
	}

	describe('generateSecret', () => {
		it('starts with whsec_', () => {
			const secret = generateSecret();
			expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
		});
	});

	describe('createWebhook', () => {
		it('creates an active webhook', async () => {
			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com/hook',
				eventTypes: ['email.delivered'],
			});

			expect(webhook.status).toBe('ACTIVE');
			expect(webhook.secret).toMatch(/^whsec_/);
		});
	});

	describe('listWebhooks', () => {
		it('lists webhooks for a team', async () => {
			const { team, user } = setup();
			await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://a.example.com',
				eventTypes: ['email.sent'],
			});
			await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://b.example.com',
				eventTypes: ['email.delivered'],
			});

			expect(listWebhooks(team.id)).toHaveLength(2);
		});
	});

	describe('getWebhook', () => {
		it('returns a webhook by id', async () => {
			const { team, user } = setup();
			const created = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com/hook',
				eventTypes: ['email.delivered'],
			});

			const found = getWebhook({ id: created.id, teamId: team.id });
			expect(found.id).toBe(created.id);
		});
	});

	describe('updateWebhook', () => {
		it('updates webhook url and event types', async () => {
			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://old.example.com',
				eventTypes: ['email.sent'],
			});

			const updated = await updateWebhook({
				id: webhook.id,
				teamId: team.id,
				url: 'https://new.example.com',
				eventTypes: ['email.delivered', 'email.bounced'],
			});

			expect(updated.url).toBe('https://new.example.com');
		});

		it('rotates secret when requested', async () => {
			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com',
				eventTypes: ['email.sent'],
			});

			const updated = await updateWebhook({
				id: webhook.id,
				teamId: team.id,
				rotateSecret: true,
			});

			expect(updated.secret).not.toBe(webhook.secret);
		});
	});

	describe('setWebhookStatus', () => {
		it('pauses and resumes a webhook', async () => {
			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com',
				eventTypes: ['email.sent'],
			});

			const paused = setWebhookStatus({ id: webhook.id, teamId: team.id, status: 'PAUSED' });
			expect(paused.status).toBe('PAUSED');

			const active = setWebhookStatus({ id: webhook.id, teamId: team.id, status: 'ACTIVE' });
			expect(active.status).toBe('ACTIVE');
		});
	});

	describe('deleteWebhook', () => {
		it('deletes a webhook', async () => {
			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com',
				eventTypes: ['email.sent'],
			});

			deleteWebhook({ id: webhook.id, teamId: team.id });
			expect(() => getWebhook({ id: webhook.id, teamId: team.id })).toThrow('Webhook not found');
		});
	});

	describe('emit', () => {
		it('inserts webhook_calls and enqueues dispatch jobs', async () => {
			const { team, user, domain } = setup();
			await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com/hook',
				eventTypes: ['email.delivered'],
				domainIds: [domain.id],
			});

			await emit(
				team.id,
				'email.delivered',
				{
					id: 'email-1',
					status: 'DELIVERED',
					from: 'a@example.com',
					to: ['b@example.com'],
					occurredAt: new Date().toISOString(),
					domainId: domain.id,
					subject: 'Test',
				},
				{ domainId: domain.id },
			);

			const calls = db.select().from(webhookCalls).where(eq(webhookCalls.teamId, team.id)).all();
			expect(calls).toHaveLength(1);
			expect(calls[0].status).toBe('PENDING');

			const jobs = db
				.select()
				.from(queueJobs)
				.where(eq(queueJobs.queue, QUEUES.WEBHOOK_DISPATCH))
				.all();
			expect(jobs).toHaveLength(1);
		});
	});

	describe('testWebhook', () => {
		it('creates a test call and enqueues it', async () => {
			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com',
				eventTypes: ['email.sent'],
			});

			const callId = await testWebhook({ webhookId: webhook.id, teamId: team.id });
			const call = db.select().from(webhookCalls).where(eq(webhookCalls.id, callId)).get();
			expect(call?.type).toBe('webhook.test');
		});
	});

	describe('retryCall', () => {
		it('resets a call to pending and re-enqueues', async () => {
			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com',
				eventTypes: ['email.sent'],
			});

			const callId = await testWebhook({ webhookId: webhook.id, teamId: team.id });
			db.update(webhookCalls)
				.set({ status: 'FAILED', attempt: 3 })
				.where(eq(webhookCalls.id, callId))
				.run();

			await retryCall({ callId, teamId: team.id });

			const call = db.select().from(webhookCalls).where(eq(webhookCalls.id, callId)).get();
			expect(call?.status).toBe('PENDING');
			expect(call?.attempt).toBe(0);
		});
	});

	describe('processWebhookCall', () => {
		it('delivers webhook on successful fetch', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response('ok', { status: 200 })),
			);

			const { team, user } = setup();
			const webhook = await createWebhook({
				teamId: team.id,
				userId: user.id,
				url: 'https://example.com/hook',
				eventTypes: ['email.sent'],
			});

			const callId = await testWebhook({ webhookId: webhook.id, teamId: team.id });
			const job = db.select().from(queueJobs).where(eq(queueJobs.jobId, callId)).get();
			expect(job).toBeDefined();

			await processWebhookCall({ callId }, { ...job!, attempts: 1 });

			const call = db.select().from(webhookCalls).where(eq(webhookCalls.id, callId)).get();
			expect(call?.status).toBe('DELIVERED');
			expect(call?.responseStatus).toBe(200);
		});
	});
});
