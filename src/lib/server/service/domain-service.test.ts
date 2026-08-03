import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain as insertDomain,
	createSesSetting,
} from '../../../tests/helpers/factories';
import * as ses from '../aws/ses';
import {
	createDomain,
	deleteDomain,
	getDnsRecords,
	getDomains,
	updateDomain,
	validateDomainFromEmail,
} from './domain-service';

vi.mock('$lib/server/aws/ses', () => ({
	addDomain: vi.fn(async () => 'pubkey'),
	deleteDomain: vi.fn(async () => true),
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

describe('domain-service', () => {
	function setupWithSesSetting(region = 'us-east-1') {
		const team = createTeam();
		createSesSetting({ region });
		return { team, region };
	}

	describe('validateDomainFromEmail', () => {
		it('throws for invalid email', async () => {
			const team = createTeam();
			await expect(validateDomainFromEmail('not-an-email', team.id)).rejects.toThrow(
				'From email is invalid',
			);
		});

		it('throws when domain does not belong to team', async () => {
			const team = createTeam();
			await expect(validateDomainFromEmail('noreply@unknown.example.com', team.id)).rejects.toThrow(
				'Domain: unknown.example.com of from email is wrong',
			);
		});

		it('throws when domain is not verified', async () => {
			const team = createTeam();
			insertDomain(team.id, { name: 'pending.example.com', status: 'PENDING' });

			await expect(validateDomainFromEmail('noreply@pending.example.com', team.id)).rejects.toThrow(
				'is not verified',
			);
		});

		it('returns domain for a verified from address', async () => {
			const team = createTeam();
			const domain = insertDomain(team.id, {
				name: 'verified.example.com',
				status: 'SUCCESS',
			});

			const result = await validateDomainFromEmail('noreply@verified.example.com', team.id);
			expect(result.id).toBe(domain.id);
		});

		it('parses display-name wrapped from addresses', async () => {
			const team = createTeam();
			const domain = insertDomain(team.id, {
				name: 'verified.example.com',
				status: 'SUCCESS',
			});

			const result = await validateDomainFromEmail('Team <noreply@verified.example.com>', team.id);
			expect(result.id).toBe(domain.id);
		});
	});

	describe('getDnsRecords', () => {
		it('returns MX, SPF, DKIM and DMARC records', () => {
			const team = createTeam();
			const domain = insertDomain(team.id, {
				name: 'mail.example.com',
				region: 'us-east-1',
				status: 'SUCCESS',
			});

			const records = getDnsRecords(domain);
			expect(records).toHaveLength(4);
			expect(records.some((r) => r.type === 'MX')).toBe(true);
			expect(records.some((r) => r.value.includes('p=test-public-key'))).toBe(true);
		});
	});

	describe('createDomain', () => {
		it('creates a domain via SES and returns DNS records', async () => {
			const { team } = setupWithSesSetting('us-east-1');

			const created = await createDomain(team.id, 'mail.example.com', 'us-east-1');
			expect(created.name).toBe('mail.example.com');
			expect(created.dnsRecords.length).toBeGreaterThan(0);
			expect(ses.addDomain).toHaveBeenCalled();
		});

		it('throws when SES setting is missing', async () => {
			const team = createTeam();

			await expect(createDomain(team.id, 'mail.example.com', 'eu-west-1')).rejects.toThrow(
				'Ses setting not found',
			);
		});
	});

	describe('getDomains', () => {
		it('returns domains with DNS records', async () => {
			const team = createTeam();
			insertDomain(team.id, { name: 'a.example.com' });
			insertDomain(team.id, { name: 'b.example.com' });

			const domains = await getDomains(team.id);
			expect(domains).toHaveLength(2);
			expect(domains[0].dnsRecords).toBeDefined();
		});
	});

	describe('updateDomain', () => {
		it('updates tracking settings', async () => {
			const team = createTeam();
			const domain = insertDomain(team.id);

			const updated = await updateDomain(domain.id, {
				clickTracking: true,
				openTracking: true,
			});
			expect(updated.clickTracking).toBe(true);
			expect(updated.openTracking).toBe(true);
		});
	});

	describe('deleteDomain', () => {
		it('deletes domain via SES mock', async () => {
			const team = createTeam();
			const domain = insertDomain(team.id, { name: 'delete.example.com' });

			const deleted = await deleteDomain(domain.id);
			expect(deleted.id).toBe(domain.id);
			expect(ses.deleteDomain).toHaveBeenCalled();
		});
	});
});
