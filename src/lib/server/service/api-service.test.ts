import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import { createTeam, createDomain } from '../../../tests/helpers/factories';
import {
	addApiKey,
	getTeamAndApiKey,
	updateApiKey,
	deleteApiKey,
	listApiKeys
} from './api-service';
import { db } from '../db';
import { apiKeys } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('api-service', () => {
	beforeEach(() => resetDb());

	it('addApiKey returns us_ format token', async () => {
		const team = createTeam();
		const token = await addApiKey({
			name: 'Test Key',
			permission: 'FULL',
			teamId: team.id
		});

		expect(token).toMatch(/^us_[0-9a-z]{10}_[0-9a-f]{32}$/);
	});

	it('getTeamAndApiKey resolves a valid key', async () => {
		const team = createTeam();
		const domain = createDomain(team.id);
		const token = await addApiKey({
			name: 'Valid Key',
			permission: 'FULL',
			teamId: team.id,
			domainId: domain.id
		});

		const result = await getTeamAndApiKey(token);

		expect(result).not.toBeNull();
		expect(result!.team!.id).toBe(team.id);
		expect(result!.apiKey.name).toBe('Valid Key');
		expect(result!.apiKey.domain).toEqual({ id: domain.id, name: domain.name });
	});

	it('getTeamAndApiKey returns null for invalid token', async () => {
		const team = createTeam();
		const token = await addApiKey({
			name: 'Key',
			permission: 'FULL',
			teamId: team.id
		});

		const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');
		expect(await getTeamAndApiKey(tampered)).toBeNull();
	});

	it('getTeamAndApiKey returns null for unknown client id', async () => {
		expect(await getTeamAndApiKey('us_unknownid_0123456789abcdef0123456789abcdef')).toBeNull();
	});

	it('getTeamAndApiKey returns null for malformed key', async () => {
		expect(await getTeamAndApiKey('not-a-key')).toBeNull();
		expect(await getTeamAndApiKey('us_onlyonepart')).toBeNull();
	});

	it('addApiKey throws DOMAIN_NOT_FOUND for bad domainId', async () => {
		const team = createTeam();
		const otherTeam = createTeam();
		const otherDomain = createDomain(otherTeam.id);

		await expect(
			addApiKey({
				name: 'Bad Domain',
				permission: 'FULL',
				teamId: team.id,
				domainId: otherDomain.id
			})
		).rejects.toThrow('DOMAIN_NOT_FOUND');

		await expect(
			addApiKey({
				name: 'Missing Domain',
				permission: 'FULL',
				teamId: team.id,
				domainId: 99999
			})
		).rejects.toThrow('DOMAIN_NOT_FOUND');
	});

	it('updateApiKey updates name and domain', async () => {
		const team = createTeam();
		const domain1 = createDomain(team.id);
		const domain2 = createDomain(team.id);
		const token = await addApiKey({
			name: 'Original',
			permission: 'FULL',
			teamId: team.id,
			domainId: domain1.id
		});
		const resolved = await getTeamAndApiKey(token);
		const keyId = resolved!.apiKey.id;

		const updated = await updateApiKey({
			id: keyId,
			teamId: team.id,
			name: 'Renamed',
			domainId: domain2.id
		});

		expect(updated?.name).toBe('Renamed');
		expect(updated?.domainId).toBe(domain2.id);
	});

	it('updateApiKey throws DOMAIN_NOT_FOUND for bad domainId', async () => {
		const team = createTeam();
		const token = await addApiKey({ name: 'Key', permission: 'FULL', teamId: team.id });
		const keyId = (await getTeamAndApiKey(token))!.apiKey.id;

		await expect(
			updateApiKey({ id: keyId, teamId: team.id, domainId: 99999 })
		).rejects.toThrow('DOMAIN_NOT_FOUND');
	});

	it('deleteApiKey removes the key', async () => {
		const team = createTeam();
		const token = await addApiKey({ name: 'To Delete', permission: 'FULL', teamId: team.id });
		const keyId = (await getTeamAndApiKey(token))!.apiKey.id;

		await deleteApiKey(keyId);

		expect(await getTeamAndApiKey(token)).toBeNull();
		expect(db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).get()).toBeUndefined();
	});

	it('listApiKeys returns keys for the team ordered newest first', async () => {
		const team = createTeam();
		const otherTeam = createTeam();

		await addApiKey({ name: 'First', permission: 'FULL', teamId: team.id });
		await addApiKey({ name: 'Second', permission: 'SENDING', teamId: team.id });
		await addApiKey({ name: 'Other Team', permission: 'FULL', teamId: otherTeam.id });

		const keys = await listApiKeys(team.id);

		expect(keys).toHaveLength(2);
		expect(keys.map((k) => k.name).sort()).toEqual(['First', 'Second']);
		expect(keys.every((k) => k.teamId === team.id)).toBe(true);
	});
});
