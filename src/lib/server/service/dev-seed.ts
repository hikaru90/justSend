import { eq } from 'drizzle-orm';
import { env } from '../env';
import { db } from '../db';
import { domains, teams } from '../db/schema';
import { migrate } from '../db/migrate';

const DEV_DOMAIN_NAME = 'localhost.dev';

/**
 * In development, ensure the given team has at least one domain so the
 * domain-scoped dashboard is usable without AWS SES setup.
 */
export function ensureDevDomain(teamId: number): typeof domains.$inferSelect | null {
	if (env.NODE_ENV !== 'development') return null;

	const existing = db.select().from(domains).where(eq(domains.teamId, teamId)).limit(1).get();
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
			isVerifying: false,
		})
		.returning()
		.get();

	console.log(`[dev] Seeded example domain "${DEV_DOMAIN_NAME}" for team ${teamId}`);
	return created;
}

/**
 * CLI entry for `npm run db:seed`. Applies migrations, then seeds a verified
 * localhost.dev domain on the first team (if any) so the UI is usable without AWS.
 */
export function seed() {
	migrate();

	const team = db.select({ id: teams.id, name: teams.name }).from(teams).limit(1).get();
	if (!team) {
		console.log(
			'[seed] No teams yet. Sign up in the app first, then re-run `npm run db:seed` — or just use the app (dev auto-seeds a domain on first login).',
		);
		return;
	}

	const previous = env.NODE_ENV;
	// ensureDevDomain only runs in development
	(env as { NODE_ENV: string }).NODE_ENV = 'development';
	try {
		const domain = ensureDevDomain(team.id);
		if (domain) {
			console.log(`[seed] Ready — team "${team.name}" (#${team.id}) has domain ${domain.name}`);
		} else {
			const existing = db.select().from(domains).where(eq(domains.teamId, team.id)).limit(1).get();
			console.log(
				`[seed] Team "${team.name}" (#${team.id}) already has domain ${existing?.name ?? '(none)'}`,
			);
		}
	} finally {
		(env as { NODE_ENV: string }).NODE_ENV = previous;
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	seed();
}
