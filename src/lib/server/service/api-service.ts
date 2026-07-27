import { and, desc, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '../db';
import { apiKeys, domains, teams, type ApiPermission } from '../db/schema';
import { createSecureHash, smallId, verifySecureHash } from '../crypto';

export async function addApiKey({
	name,
	permission,
	teamId,
	domainId
}: {
	name: string;
	permission: ApiPermission;
	teamId: number;
	domainId?: number;
}): Promise<string> {
	if (domainId !== undefined) {
		const domain = db
			.select({ id: domains.id })
			.from(domains)
			.where(and(eq(domains.id, domainId), eq(domains.teamId, teamId)))
			.get();

		if (!domain) {
			throw new Error('DOMAIN_NOT_FOUND');
		}
	}

	const clientId = smallId(10);
	const token = randomBytes(16).toString('hex');
	const hashedToken = createSecureHash(token);

	const apiKey = `us_${clientId}_${token}`;

	db.insert(apiKeys)
		.values({
			name,
			permission,
			teamId,
			domainId: domainId ?? null,
			tokenHash: hashedToken,
			partialToken: `${apiKey.slice(0, 6)}...${apiKey.slice(-3)}`,
			clientId
		})
		.run();

	return apiKey;
}

export async function getTeamAndApiKey(apiKey: string) {
	const parts = apiKey.split('_');
	const clientId = parts[1];
	const token = parts.slice(2).join('_');

	if (!clientId || !token) {
		return null;
	}

	const apiKeyRow = db.select().from(apiKeys).where(eq(apiKeys.clientId, clientId)).get();

	if (!apiKeyRow) {
		return null;
	}

	const isValid = verifySecureHash(token, apiKeyRow.tokenHash);
	if (!isValid) {
		return null;
	}

	const domain = apiKeyRow.domainId
		? (db
				.select({ id: domains.id, name: domains.name })
				.from(domains)
				.where(eq(domains.id, apiKeyRow.domainId))
				.get() ?? null)
		: null;

	const team = db.select().from(teams).where(eq(teams.id, apiKeyRow.teamId)).get() ?? null;

	return { team, apiKey: { ...apiKeyRow, domain } };
}

export async function updateApiKey({
	id,
	teamId,
	name,
	domainId
}: {
	id: number;
	teamId: number;
	name?: string;
	domainId?: number | null;
}) {
	if (domainId !== undefined && domainId !== null) {
		const domain = db
			.select({ id: domains.id })
			.from(domains)
			.where(and(eq(domains.id, domainId), eq(domains.teamId, teamId)))
			.get();

		if (!domain) {
			throw new Error('DOMAIN_NOT_FOUND');
		}
	}

	return db
		.update(apiKeys)
		.set({
			...(name !== undefined ? { name } : {}),
			...(domainId !== undefined ? { domainId } : {})
		})
		.where(and(eq(apiKeys.id, id), eq(apiKeys.teamId, teamId)))
		.returning()
		.get();
}

export async function deleteApiKey(id: number) {
	db.delete(apiKeys).where(eq(apiKeys.id, id)).run();
}

export async function listApiKeys(teamId: number) {
	return db
		.select()
		.from(apiKeys)
		.where(eq(apiKeys.teamId, teamId))
		.orderBy(desc(apiKeys.createdAt))
		.all();
}
