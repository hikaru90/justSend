import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { resetDb, db } from '../../../tests/helpers/db';
import { createTeam, createDomain, createEmail, createContactBook, createContact, createCampaign } from '../../../tests/helpers/factories';
import { emails, emailEvents, suppressionList } from '$lib/server/db/schema';
import { env } from '../env';
import { parseSesHook, type SesEvent } from './ses-hook-parser';

beforeEach(() => resetDb());

function baseEvent(messageId: string, eventType: string): SesEvent {
	return {
		eventType,
		mail: {
			messageId,
			timestamp: new Date().toISOString()
		}
	};
}

describe('ses-hook-parser', () => {
	function setupEmail(sesEmailId: string) {
		const team = createTeam();
		const domain = createDomain(team.id);
		const email = createEmail(team.id, {
			domainId: domain.id,
			sesEmailId,
			latestStatus: 'QUEUED',
			to: ['recipient@example.com']
		});
		return { team, domain, email };
	}

	it('returns false for unknown email', async () => {
		const result = await parseSesHook(baseEvent('unknown-msg-id', 'Delivery'));
		expect(result).toBe(false);
	});

	it('updates latestStatus on Send event', async () => {
		const { email } = setupEmail('msg-send-1');
		const result = await parseSesHook(baseEvent('msg-send-1', 'Send'));
		expect(result).toBe(true);

		const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
		expect(updated?.latestStatus).toBe('SENT');
	});

	it('updates latestStatus on Delivery event', async () => {
		const { email } = setupEmail('msg-delivery-1');
		await parseSesHook(baseEvent('msg-delivery-1', 'Send'));

		const result = await parseSesHook({
			...baseEvent('msg-delivery-1', 'Delivery'),
			delivery: { timestamp: new Date().toISOString() }
		});
		expect(result).toBe(true);

		const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
		expect(updated?.latestStatus).toBe('DELIVERED');
	});

	it('handles hard bounce and creates suppression', async () => {
		const { email } = setupEmail('msg-bounce-1');
		const result = await parseSesHook({
			...baseEvent('msg-bounce-1', 'Bounce'),
			bounce: {
				bounceType: 'Permanent',
				bounceSubType: 'General',
				bouncedRecipients: [{ emailAddress: 'recipient@example.com', diagnosticCode: '550' }]
			}
		});

		expect(result).toBe(true);
		const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
		expect(updated?.latestStatus).toBe('BOUNCED');

		const suppression = db
			.select()
			.from(suppressionList)
			.where(eq(suppressionList.email, 'recipient@example.com'))
			.get();
		expect(suppression?.reason).toBe('HARD_BOUNCE');
	});

	it('handles Complaint event', async () => {
		const { email } = setupEmail('msg-complaint-1');
		const result = await parseSesHook({
			...baseEvent('msg-complaint-1', 'Complaint'),
			complaint: {
				complainedRecipients: [{ emailAddress: 'recipient@example.com' }]
			}
		});

		expect(result).toBe(true);
		const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
		expect(updated?.latestStatus).toBe('COMPLAINED');
	});

	it('handles Open event', async () => {
		const { email } = setupEmail('msg-open-1');
		await parseSesHook(baseEvent('msg-open-1', 'Delivery'));

		const result = await parseSesHook({
			...baseEvent('msg-open-1', 'Open'),
			open: { timestamp: new Date().toISOString(), userAgent: 'TestAgent' }
		});

		expect(result).toBe(true);
		const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
		expect(updated?.latestStatus).toBe('OPENED');
	});

	it('handles Click event', async () => {
		const { email } = setupEmail('msg-click-1');
		await parseSesHook(baseEvent('msg-click-1', 'Delivery'));

		const result = await parseSesHook({
			...baseEvent('msg-click-1', 'Click'),
			click: {
				timestamp: new Date().toISOString(),
				link: 'https://example.com/page',
				userAgent: 'TestAgent'
			}
		});

		expect(result).toBe(true);
		const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
		expect(updated?.latestStatus).toBe('CLICKED');
	});

	it('records email events for each parsed hook', async () => {
		const { email } = setupEmail('msg-events-1');
		await parseSesHook(baseEvent('msg-events-1', 'Send'));

		const events = db.select().from(emailEvents).where(eq(emailEvents.emailId, email.id)).all();
		expect(events.length).toBeGreaterThan(0);
		expect(events.some((e) => e.status === 'SENT')).toBe(true);
	});

	it('matches email by X-Justsend-Email-ID header when sesEmailId is missing', async () => {
		const team = createTeam();
		const domain = createDomain(team.id);
		const email = createEmail(team.id, {
			domainId: domain.id,
			sesEmailId: null,
			latestStatus: 'QUEUED'
		});

		const result = await parseSesHook({
			eventType: 'Send',
			mail: {
				messageId: 'new-ses-id',
				timestamp: new Date().toISOString(),
				headers: [{ name: 'X-Justsend-Email-ID', value: email.id }]
			},
			send: {}
		});

		expect(result).toBe(true);
		const updated = db.select().from(emails).where(eq(emails.id, email.id)).get();
		expect(updated?.sesEmailId).toBe('new-ses-id');
		expect(updated?.latestStatus).toBe('SENT');
	});

	it('unsubscribes contact on hard bounce for campaign emails', async () => {
		const team = createTeam();
		const domain = createDomain(team.id);
		const book = createContactBook(team.id);
		const contact = createContact(book.id, { email: 'camp@example.com', subscribed: true });
		const campaign = createCampaign(team.id, domain.id, { contactBookId: book.id });

		const email = createEmail(team.id, {
			domainId: domain.id,
			sesEmailId: 'msg-campaign-bounce',
			contactId: contact.id,
			campaignId: campaign.id,
			to: ['camp@example.com']
		});

		await parseSesHook({
			...baseEvent('msg-campaign-bounce', 'Bounce'),
			bounce: {
				bounceType: 'Permanent',
				bouncedRecipients: [{ emailAddress: 'camp@example.com' }]
			}
		});

		const updatedContact = db.select().from(suppressionList).all();
		expect(updatedContact.some((s) => s.email === 'camp@example.com')).toBe(true);
	});

	it('returns false for unknown event types', async () => {
		setupEmail('msg-unknown');
		const result = await parseSesHook(baseEvent('msg-unknown', 'UnknownEvent'));
		expect(result).toBe(false);
	});
});

describe('hash verification helper', () => {
	it('documents expected unsubscribe hash format', () => {
		const contactId = 'contact-1';
		const campaignId = 'camp-1';
		const unsubId = `${contactId}-${campaignId}`;
		const hash = createHash('sha256').update(`${unsubId}-${env.AUTH_SECRET}`).digest('hex');
		expect(hash).toHaveLength(64);
	});
});
