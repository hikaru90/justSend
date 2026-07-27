import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import { createTeam } from '../../../tests/helpers/factories';
import {
	getIdempotencyKey,
	setIdempotencyKey,
	deleteIdempotencyKey
} from './idempotency-service';

describe('idempotency-service', () => {
	beforeEach(() => resetDb());

	it('returns null when key is missing', () => {
		const team = createTeam();
		expect(getIdempotencyKey(team.id, 'missing-key')).toBeNull();
	});

	it('set and get round-trip a response', () => {
		const team = createTeam();
		const response = { id: 'email_123', status: 'queued' };

		setIdempotencyKey(team.id, 'req-1', response);
		const stored = getIdempotencyKey<{ id: string; status: string }>(team.id, 'req-1');

		expect(stored).not.toBeNull();
		expect(stored!.response).toEqual(response);
		expect(stored!.createdAt).toBeTruthy();
	});

	it('first write wins on conflict', () => {
		const team = createTeam();

		setIdempotencyKey(team.id, 'dup-key', { value: 'first' });
		setIdempotencyKey(team.id, 'dup-key', { value: 'second' });

		const stored = getIdempotencyKey<{ value: string }>(team.id, 'dup-key');
		expect(stored!.response.value).toBe('first');
	});

	it('deleteIdempotencyKey removes the record', () => {
		const team = createTeam();
		setIdempotencyKey(team.id, 'to-delete', { ok: true });

		deleteIdempotencyKey(team.id, 'to-delete');

		expect(getIdempotencyKey(team.id, 'to-delete')).toBeNull();
	});

	it('keys are scoped to team', () => {
		const team1 = createTeam();
		const team2 = createTeam();

		setIdempotencyKey(team1.id, 'shared-key', { team: 1 });

		expect(getIdempotencyKey(team1.id, 'shared-key')).not.toBeNull();
		expect(getIdempotencyKey(team2.id, 'shared-key')).toBeNull();
	});
});
