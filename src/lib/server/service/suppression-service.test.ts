import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/aws/ses', () => ({
	deleteFromSesSuppressionList: vi.fn(async () => undefined)
}));

import { deleteFromSesSuppressionList } from '$lib/server/aws/ses';
import { resetDb } from '../../../tests/helpers/db';
import { createTeam, createDomain } from '../../../tests/helpers/factories';
import {
	addSuppression,
	isEmailSuppressed,
	removeSuppression,
	checkMultipleEmails,
	getSuppressionList,
	addMultipleSuppressions,
	getSuppressionStats
} from './suppression-service';
import { db } from '../db';
import { suppressionList } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('suppression-service', () => {
	beforeEach(() => {
		resetDb();
		vi.clearAllMocks();
	});

	it('addSuppression lowercases, trims, and upserts', async () => {
		const team = createTeam();

		const first = await addSuppression({
			email: '  User@Example.COM  ',
			teamId: team.id,
			reason: 'MANUAL',
			source: 'test'
		});

		expect(first.email).toBe('user@example.com');
		expect(first.reason).toBe('MANUAL');

		const updated = await addSuppression({
			email: 'USER@example.com',
			teamId: team.id,
			reason: 'HARD_BOUNCE',
			source: 'bounce'
		});

		expect(updated.email).toBe('user@example.com');
		expect(updated.reason).toBe('HARD_BOUNCE');
		expect(updated.source).toBe('bounce');

		const rows = db.select().from(suppressionList).where(eq(suppressionList.teamId, team.id)).all();
		expect(rows).toHaveLength(1);
	});

	it('isEmailSuppressed checks normalized email', async () => {
		const team = createTeam();
		await addSuppression({ email: 'blocked@test.com', teamId: team.id, reason: 'MANUAL' });

		expect(await isEmailSuppressed('  Blocked@Test.COM ', team.id)).toBe(true);
		expect(await isEmailSuppressed('allowed@test.com', team.id)).toBe(false);
	});

	it('removeSuppression deletes locally and calls SES cleanup', async () => {
		const team = createTeam();
		createDomain(team.id, { region: 'us-east-1' });
		createDomain(team.id, { region: 'eu-west-1' });

		await addSuppression({ email: 'remove@test.com', teamId: team.id, reason: 'MANUAL' });
		await removeSuppression('Remove@Test.com', team.id);

		expect(await isEmailSuppressed('remove@test.com', team.id)).toBe(false);
		expect(deleteFromSesSuppressionList).toHaveBeenCalledWith('remove@test.com', 'us-east-1');
		expect(deleteFromSesSuppressionList).toHaveBeenCalledWith('remove@test.com', 'eu-west-1');
	});

	it('checkMultipleEmails returns per-input lookup map', async () => {
		const team = createTeam();
		await addSuppression({ email: 'a@test.com', teamId: team.id, reason: 'MANUAL' });

		const result = await checkMultipleEmails(
			['A@test.com', 'b@test.com', '  a@test.com  '],
			team.id
		);

		expect(result['A@test.com']).toBe(true);
		expect(result['b@test.com']).toBe(false);
		expect(result['  a@test.com  ']).toBe(true);
	});

	it('getSuppressionList filters, paginates, and sorts', async () => {
		const team = createTeam();
		await addSuppression({ email: 'alice@test.com', teamId: team.id, reason: 'MANUAL' });
		await addSuppression({ email: 'bob@test.com', teamId: team.id, reason: 'COMPLAINT' });
		await addSuppression({ email: 'charlie@test.com', teamId: team.id, reason: 'MANUAL' });

		const filtered = await getSuppressionList({
			teamId: team.id,
			search: 'alice',
			reason: 'MANUAL',
			limit: 10,
			page: 1
		});

		expect(filtered.total).toBe(1);
		expect(filtered.suppressions).toHaveLength(1);
		expect(filtered.suppressions[0].email).toBe('alice@test.com');

		const page = await getSuppressionList({
			teamId: team.id,
			limit: 2,
			page: 1,
			sortBy: 'email',
			sortOrder: 'asc'
		});

		expect(page.total).toBe(3);
		expect(page.suppressions).toHaveLength(2);
		expect(page.suppressions[0].email).toBe('alice@test.com');
	});

	it('addMultipleSuppressions deduplicates emails', async () => {
		const team = createTeam();

		await addMultipleSuppressions(
			team.id,
			['Dup@test.com', 'DUP@test.com', '  dup@test.com  ', 'other@test.com'],
			'MANUAL'
		);

		const rows = db.select().from(suppressionList).where(eq(suppressionList.teamId, team.id)).all();
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.email).sort()).toEqual(['dup@test.com', 'other@test.com']);
	});

	it('getSuppressionStats aggregates by reason', async () => {
		const team = createTeam();
		await addSuppression({ email: 'a@test.com', teamId: team.id, reason: 'MANUAL' });
		await addSuppression({ email: 'b@test.com', teamId: team.id, reason: 'MANUAL' });
		await addSuppression({ email: 'c@test.com', teamId: team.id, reason: 'COMPLAINT' });
		await addSuppression({ email: 'd@test.com', teamId: team.id, reason: 'HARD_BOUNCE' });

		const stats = await getSuppressionStats(team.id);

		expect(stats).toEqual({
			MANUAL: 2,
			COMPLAINT: 1,
			HARD_BOUNCE: 1
		});
	});
});
