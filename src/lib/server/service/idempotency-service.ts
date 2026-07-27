import { and, eq } from 'drizzle-orm';
import { cuid, nowIso, parseJsonObject } from '$lib/utils';
import { db } from '../db';
import { idempotencyKeys } from '../db/schema';

export type IdempotencyRecord<T = Record<string, unknown>> = {
	response: T;
	createdAt: string;
};

/**
 * Return a previously stored idempotency response for a team/key pair, or null
 * if none has been recorded yet.
 */
export function getIdempotencyKey<T = Record<string, unknown>>(
	teamId: number,
	key: string
): IdempotencyRecord<T> | null {
	const row = db
		.select()
		.from(idempotencyKeys)
		.where(and(eq(idempotencyKeys.teamId, teamId), eq(idempotencyKeys.key, key)))
		.get();

	if (!row) {
		return null;
	}

	return {
		response: parseJsonObject<Record<string, unknown>>(row.response) as T,
		createdAt: row.createdAt
	};
}

/**
 * Persist the response for a team/key pair. Concurrent writers with the same
 * key are treated idempotently — the first stored value wins.
 */
export function setIdempotencyKey(teamId: number, key: string, response: unknown): void {
	db.insert(idempotencyKeys)
		.values({
			id: cuid(),
			teamId,
			key,
			response: JSON.stringify(response ?? {}),
			createdAt: nowIso()
		})
		.onConflictDoNothing({
			target: [idempotencyKeys.teamId, idempotencyKeys.key]
		})
		.run();
}

export function deleteIdempotencyKey(teamId: number, key: string): void {
	db.delete(idempotencyKeys)
		.where(and(eq(idempotencyKeys.teamId, teamId), eq(idempotencyKeys.key, key)))
		.run();
}
