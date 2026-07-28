import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import { createSesSetting as insertSesSetting } from '../../../tests/helpers/factories';
import {
	createSesSetting,
	getAllSettings,
	getSetting,
	updateSesSetting
} from './ses-settings-service';

vi.mock('$lib/server/aws/sns', () => ({
	createTopic: vi.fn(async () => 'arn:aws:sns:us-east-1:123:test-topic'),
	subscribeHttp: vi.fn(async () => undefined),
	deleteTopic: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/aws/ses', () => ({
	addWebhookConfiguration: vi.fn(async () => true)
}));

beforeEach(() => {
	resetDb();
	vi.clearAllMocks();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('ok', { status: 200 }))
	);
});

describe('ses-settings-service', () => {
	describe('getSetting / getAllSettings', () => {
		it('loads factory-inserted settings from DB on first access', () => {
			insertSesSetting({
				region: 'us-east-1',
				idPrefix: 'factory1',
				configGeneral: 'owlery-general',
				configFull: 'owlery-full'
			});
			insertSesSetting({
				region: 'eu-west-1',
				idPrefix: 'factory2',
				configGeneral: 'owlery-general-eu'
			});

			const us = getSetting('us-east-1');
			expect(us).not.toBeNull();
			expect(us!.idPrefix).toBe('factory1');

			const all = getAllSettings();
			expect(all).toHaveLength(2);
		});

		it('returns null for unknown region', () => {
			expect(getSetting('ca-central-1')).toBeNull();
		});
	});

	describe('updateSesSetting', () => {
		it('updates rate limits and refreshes cache', async () => {
			const setting = insertSesSetting({
				region: 'ap-south-1',
				sesEmailRateLimit: 10,
				transactionalQuota: 50
			});

			const updated = await updateSesSetting({
				id: setting.id,
				sendingRateLimit: 25,
				transactionalQuota: 75
			});

			expect(updated.sesEmailRateLimit).toBe(25);
			expect(updated.transactionalQuota).toBe(75);
			expect(getSetting('ap-south-1')?.sesEmailRateLimit).toBe(25);
		});
	});

	describe('createSesSetting', () => {
		it('creates a new SES setting when region is available', async () => {
			const created = await createSesSetting({
				region: 'us-west-2',
				owleryUrl: 'http://localhost:5173',
				sendingRateLimit: 14,
				transactionalQuota: 70
			});

			expect(created.region).toBe('us-west-2');
			expect(getSetting('us-west-2')?.region).toBe('us-west-2');
		});

		it('rejects duplicate region', async () => {
			await createSesSetting({
				region: 'sa-east-1',
				owleryUrl: 'http://localhost:5173',
				sendingRateLimit: 10,
				transactionalQuota: 50
			});

			await expect(
				createSesSetting({
					region: 'sa-east-1',
					owleryUrl: 'http://localhost:5173',
					sendingRateLimit: 10,
					transactionalQuota: 50
				})
			).rejects.toThrow('SesSetting for region sa-east-1 already exists');
		});

		it('rejects invalid callback URL', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => new Response('not found', { status: 404 }))
			);

			await expect(
				createSesSetting({
					region: 'ap-northeast-1',
					owleryUrl: 'http://localhost:9999',
					sendingRateLimit: 10,
					transactionalQuota: 50
				})
			).rejects.toThrow('Callback URL');
		});
	});
});
