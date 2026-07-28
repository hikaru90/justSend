import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { resetDb, db } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createContactBook,
	createContact
} from '../../../tests/helpers/factories';
import { campaigns, queueJobs } from '$lib/server/db/schema';
import { QUEUES } from '../queue/constants';
import {
	createCampaign,
	deleteCampaign,
	getCampaign,
	listCampaigns,
	pauseCampaign,
	resumeCampaign,
	scheduleCampaign,
	sendCampaign,
	updateCampaign
} from './campaign-service';

beforeEach(() => resetDb());

const UNSUB_HTML = '<p>Hello</p><a href="{{justsend_unsubscribe_url}}">Unsubscribe</a>';

describe('campaign-service', () => {
	function setup() {
		const team = createTeam();
		const domain = createDomain(team.id, { name: 'mail.example.com', status: 'SUCCESS' });
		const book = createContactBook(team.id);
		createContact(book.id, { email: 'sub@example.com', subscribed: true });
		return { team, domain, book };
	}

	describe('createCampaign', () => {
		it('creates a draft campaign with a verified domain', async () => {
			const { team, domain, book } = setup();

			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Newsletter',
				from: `noreply@${domain.name}`,
				subject: 'Hello',
				html: UNSUB_HTML,
				contactBookId: book.id
			});

			expect(campaign.status).toBe('DRAFT');
			expect(campaign.domainId).toBe(domain.id);
		});

		it('throws when from domain is not verified', async () => {
			const team = createTeam();
			createDomain(team.id, { name: 'pending.example.com', status: 'PENDING' });

			await expect(
				createCampaign({
					teamId: team.id,
					name: 'Bad',
					from: 'noreply@pending.example.com',
					subject: 'Hi',
					html: UNSUB_HTML
				})
			).rejects.toThrow('is not verified');
		});
	});

	describe('getCampaign', () => {
		it('returns a campaign by id', async () => {
			const { team, domain, book } = setup();
			const created = await createCampaign({
				teamId: team.id,
				name: 'Test',
				from: `noreply@${domain.name}`,
				subject: 'Hi',
				html: UNSUB_HTML,
				contactBookId: book.id
			});

			const found = getCampaign(created.id, team.id);
			expect(found.id).toBe(created.id);
		});

		it('throws when campaign is not found', () => {
			const team = createTeam();
			expect(() => getCampaign('missing', team.id)).toThrow('Campaign not found');
		});
	});

	describe('listCampaigns', () => {
		it('lists campaigns for a team', async () => {
			const { team, domain, book } = setup();
			await createCampaign({
				teamId: team.id,
				name: 'A',
				from: `noreply@${domain.name}`,
				subject: 'A',
				html: UNSUB_HTML,
				contactBookId: book.id
			});
			await createCampaign({
				teamId: team.id,
				name: 'B',
				from: `noreply@${domain.name}`,
				subject: 'B',
				html: UNSUB_HTML,
				contactBookId: book.id
			});

			const { items } = listCampaigns(team.id);
			expect(items).toHaveLength(2);
		});
	});

	describe('updateCampaign', () => {
		it('updates campaign fields', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Old',
				from: `noreply@${domain.name}`,
				subject: 'Old subject',
				html: UNSUB_HTML,
				contactBookId: book.id
			});

			const updated = await updateCampaign(campaign.id, team.id, {
				name: 'New',
				subject: 'New subject'
			});
			expect(updated.name).toBe('New');
			expect(updated.subject).toBe('New subject');
		});
	});

	describe('deleteCampaign', () => {
		it('deletes a campaign', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Delete me',
				from: `noreply@${domain.name}`,
				subject: 'Bye',
				html: UNSUB_HTML,
				contactBookId: book.id
			});

			deleteCampaign(campaign.id, team.id);
			expect(() => getCampaign(campaign.id, team.id)).toThrow('Campaign not found');
		});
	});

	describe('scheduleCampaign', () => {
		it('transitions DRAFT to SCHEDULED when unsubscribe placeholder is present', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Scheduled',
				from: `noreply@${domain.name}`,
				subject: 'Hi',
				html: UNSUB_HTML,
				contactBookId: book.id
			});

			await scheduleCampaign({ campaignId: campaign.id, teamId: team.id });

			const updated = getCampaign(campaign.id, team.id);
			expect(updated.status).toBe('SCHEDULED');
			expect(updated.total).toBe(1);
		});

		it('throws when html lacks unsubscribe placeholder', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'No unsub',
				from: `noreply@${domain.name}`,
				subject: 'Hi',
				html: '<p>No link</p>',
				contactBookId: book.id
			});

			await expect(
				scheduleCampaign({ campaignId: campaign.id, teamId: team.id })
			).rejects.toThrow('unsubscribe link');
		});
	});

	describe('pauseCampaign', () => {
		it('sets status to PAUSED', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Pause me',
				from: `noreply@${domain.name}`,
				subject: 'Hi',
				html: UNSUB_HTML,
				contactBookId: book.id
			});
			await scheduleCampaign({ campaignId: campaign.id, teamId: team.id });

			pauseCampaign({ campaignId: campaign.id, teamId: team.id });
			expect(getCampaign(campaign.id, team.id).status).toBe('PAUSED');
		});
	});

	describe('resumeCampaign', () => {
		it('resumes a paused campaign to RUNNING when scheduled time is past', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Resume me',
				from: `noreply@${domain.name}`,
				subject: 'Hi',
				html: UNSUB_HTML,
				contactBookId: book.id
			});
			await scheduleCampaign({
				campaignId: campaign.id,
				teamId: team.id,
				scheduledAt: new Date(Date.now() - 60_000)
			});
			pauseCampaign({ campaignId: campaign.id, teamId: team.id });

			resumeCampaign({ campaignId: campaign.id, teamId: team.id });

			const updated = getCampaign(campaign.id, team.id);
			expect(updated.status).toBe('RUNNING');

			const jobs = db.select().from(queueJobs).where(eq(queueJobs.queue, QUEUES.CAMPAIGN_BATCH)).all();
			expect(jobs.length).toBeGreaterThan(0);
		});

		it('resumes to SCHEDULED when scheduled time is in the future', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Future',
				from: `noreply@${domain.name}`,
				subject: 'Hi',
				html: UNSUB_HTML,
				contactBookId: book.id
			});
			const future = new Date(Date.now() + 86_400_000);
			await scheduleCampaign({
				campaignId: campaign.id,
				teamId: team.id,
				scheduledAt: future
			});
			pauseCampaign({ campaignId: campaign.id, teamId: team.id });

			resumeCampaign({ campaignId: campaign.id, teamId: team.id });
			expect(getCampaign(campaign.id, team.id).status).toBe('SCHEDULED');
		});
	});

	describe('sendCampaign', () => {
		it('sets SCHEDULED and enqueues CAMPAIGN_BATCH', async () => {
			const { team, domain, book } = setup();
			const campaign = await createCampaign({
				teamId: team.id,
				name: 'Send now',
				from: `noreply@${domain.name}`,
				subject: 'Hi',
				html: UNSUB_HTML,
				contactBookId: book.id
			});

			await sendCampaign(campaign.id);

			const updated = db.select().from(campaigns).where(eq(campaigns.id, campaign.id)).get();
			expect(updated?.status).toBe('SCHEDULED');

			const jobs = db.select().from(queueJobs).where(eq(queueJobs.queue, QUEUES.CAMPAIGN_BATCH)).all();
			expect(jobs.some((j) => j.jobId === `campaign-batch:${campaign.id}:start`)).toBe(true);
		});
	});
});
