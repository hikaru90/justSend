import { eq } from 'drizzle-orm';
import { env } from '../env';
import { db } from '../db';
import { domains, teams } from '../db/schema';

const DEV_DOMAIN_NAME = 'localhost.dev';

/**
 * In development, ensure the given team has at least one domain so the
 * domain-scoped dashboard is usable without AWS SES setup.
 */
export function ensureDevDomain(teamId: number): typeof domains.$inferSelect | null {
	if (env.NODE_ENV !== 'development') return null;

	const existing = db
		.select()
		.from(domains)
		.where(eq(domains.teamId, teamId))
		.limit(1)
		.get();
	if (existing) return null;

	const team = db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).get();
	if (!team) return null;

	const byName = db.select().from(domains).where(eq(domains.name, DEV_DOMAIN_NAME)).get();
	if (byName) {
		// Name taken by another team — skip silently.
		if (byName.teamId !== teamId) return null;
		return byName;
	}

	const created = db
		.insert(domains)
		.values({
			name: DEV_DOMAIN_NAME,
			teamId,
			status: 'SUCCESS',
			region: env.AWS_DEFAULT_REGION,
			publicKey: 'dev-public-key',
			dkimSelector: 'owlery',
			dkimStatus: 'SUCCESS',
			spfDetails: 'SUCCESS',
			dmarcAdded: true,
			isVerifying: false
		})
		.returning()
		.get();

	console.log(`[dev] Seeded example domain "${DEV_DOMAIN_NAME}" for team ${teamId}`);
	return created;
}
