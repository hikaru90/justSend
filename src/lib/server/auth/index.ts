import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { GitHub, Google, generateState, generateCodeVerifier } from 'arctic';
import { env, isAdminEmail } from '../env';
import { db } from '../db';
import {
	accounts,
	sessions,
	teamInvites,
	teamUsers,
	users,
	verificationTokens,
} from '../db/schema';
import { cuid, nowIso } from '$lib/utils';
import { createTeam } from '../service/team-service';

export const SESSION_COOKIE = 'owlery_session';
export const OAUTH_STATE_COOKIE = 'owlery_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'owlery_oauth_verifier';
export const OAUTH_PROVIDER_COOKIE = 'owlery_oauth_provider';

export type SessionUser = {
	id: number;
	name: string | null;
	email: string | null;
	image: string | null;
	isAdmin: boolean;
};

export function getGitHub() {
	if (!env.GITHUB_ID || !env.GITHUB_SECRET) return null;
	return new GitHub(env.GITHUB_ID, env.GITHUB_SECRET, `${env.HOST_URL}/api/auth/callback/github`);
}

export function getGoogle() {
	if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
	return new Google(
		env.GOOGLE_CLIENT_ID,
		env.GOOGLE_CLIENT_SECRET,
		`${env.HOST_URL}/api/auth/callback/google`,
	);
}

export function createOAuthState() {
	return { state: generateState(), codeVerifier: generateCodeVerifier() };
}

export async function canRegisterSelfHostedUser(email?: string | null) {
	const existingUser = db.select({ id: users.id }).from(users).limit(1).get();
	if (!existingUser) return true; // bootstrap first user

	if (email) {
		const user = db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
		if (user) return true;
		const invite = db
			.select()
			.from(teamInvites)
			.where(eq(teamInvites.email, email.toLowerCase()))
			.get();
		if (invite) return true;
	}
	return false;
}

export function createSession(userId: number, days = 30) {
	const sessionToken = randomBytes(32).toString('hex');
	const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
	const id = cuid();
	db.insert(sessions).values({ id, sessionToken, userId, expires }).run();
	return { id, sessionToken, expires };
}

export function deleteSession(sessionToken: string) {
	db.delete(sessions).where(eq(sessions.sessionToken, sessionToken)).run();
}

export function getSessionUser(sessionToken: string | undefined): SessionUser | null {
	if (!sessionToken) return null;
	const row = db
		.select({
			sessionExpires: sessions.expires,
			id: users.id,
			name: users.name,
			email: users.email,
			image: users.image,
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(and(eq(sessions.sessionToken, sessionToken), gt(sessions.expires, nowIso())))
		.get();
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		image: row.image,
		isAdmin: isAdminEmail(row.email),
	};
}

export async function upsertOAuthUser(input: {
	provider: string;
	providerAccountId: string;
	email?: string | null;
	name?: string | null;
	image?: string | null;
	accessToken?: string | null;
	refreshToken?: string | null;
	idToken?: string | null;
}) {
	const email = input.email?.toLowerCase() ?? null;
	const existingAccount = db
		.select()
		.from(accounts)
		.where(
			and(
				eq(accounts.provider, input.provider),
				eq(accounts.providerAccountId, input.providerAccountId),
			),
		)
		.get();

	if (existingAccount) {
		const user = db.select().from(users).where(eq(users.id, existingAccount.userId)).get();
		if (!user) throw new Error('User missing for account');
		return user;
	}

	if (!(await canRegisterSelfHostedUser(email))) {
		throw new Error('Registration requires a team invite');
	}

	let user = email ? db.select().from(users).where(eq(users.email, email)).get() : undefined;

	const isFirstUser = !db.select({ id: users.id }).from(users).limit(1).get();

	if (!user) {
		const result = db
			.insert(users)
			.values({
				name: input.name ?? null,
				email,
				emailVerified: email ? nowIso() : null,
				image: input.image ?? null,
				createdAt: nowIso(),
			})
			.returning()
			.get();
		user = result;

		if (isFirstUser) {
			await createTeam(user.id, 'My Team');
		} else if (email) {
			const invite = db.select().from(teamInvites).where(eq(teamInvites.email, email)).get();
			if (invite) {
				db.insert(teamUsers)
					.values({ teamId: invite.teamId, userId: user.id, role: invite.role })
					.run();
				db.delete(teamInvites).where(eq(teamInvites.id, invite.id)).run();
			}
		}
	}

	db.insert(accounts)
		.values({
			id: cuid(),
			userId: user.id,
			type: 'oauth',
			provider: input.provider,
			providerAccountId: input.providerAccountId,
			accessToken: input.accessToken ?? null,
			refreshToken: input.refreshToken ?? null,
			idToken: input.idToken ?? null,
		})
		.run();

	return user;
}

export function createMagicLinkToken(email: string) {
	const token = randomBytes(32).toString('hex');
	const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
	db.insert(verificationTokens).values({ identifier: email.toLowerCase(), token, expires }).run();
	return token;
}

export async function consumeMagicLinkToken(token: string) {
	const row = db
		.select()
		.from(verificationTokens)
		.where(and(eq(verificationTokens.token, token), gt(verificationTokens.expires, nowIso())))
		.get();
	if (!row) return null;
	db.delete(verificationTokens).where(eq(verificationTokens.token, token)).run();

	if (!(await canRegisterSelfHostedUser(row.identifier))) {
		throw new Error('Registration requires a team invite');
	}

	let user = db.select().from(users).where(eq(users.email, row.identifier)).get();
	const isFirstUser = !db.select({ id: users.id }).from(users).limit(1).get();

	if (!user) {
		user = db
			.insert(users)
			.values({
				email: row.identifier,
				emailVerified: nowIso(),
				createdAt: nowIso(),
			})
			.returning()
			.get();
		if (isFirstUser) {
			await createTeam(user.id, 'My Team');
		} else {
			const invite = db
				.select()
				.from(teamInvites)
				.where(eq(teamInvites.email, row.identifier))
				.get();
			if (invite) {
				db.insert(teamUsers)
					.values({ teamId: invite.teamId, userId: user.id, role: invite.role })
					.run();
				db.delete(teamInvites).where(eq(teamInvites.id, invite.id)).run();
			}
		}
	} else {
		db.update(users).set({ emailVerified: nowIso() }).where(eq(users.id, user.id)).run();
	}
	return user;
}

export function signCookieValue(value: string) {
	const sig = createHmac('sha256', env.AUTH_SECRET).update(value).digest('base64url');
	return `${value}.${sig}`;
}

export function verifyCookieValue(signed: string | undefined) {
	if (!signed) return null;
	const idx = signed.lastIndexOf('.');
	if (idx === -1) return null;
	const value = signed.slice(0, idx);
	const sig = signed.slice(idx + 1);
	const expected = createHmac('sha256', env.AUTH_SECRET).update(value).digest('base64url');
	try {
		const a = Buffer.from(sig);
		const b = Buffer.from(expected);
		if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
		return value;
	} catch {
		return null;
	}
}
