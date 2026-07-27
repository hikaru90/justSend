import { and, eq, sql } from 'drizzle-orm';
import { cuid } from '$lib/utils';
import { db } from '../db';
import { teamInvites, teamUsers, teams, users, type Role } from '../db/schema';
import { checkTeamMemberLimit } from './limit-service';

export type Team = typeof teams.$inferSelect;
export type TeamInvite = typeof teamInvites.$inferSelect;

/**
 * Create a team for a user.
 *
 * Self-hosted rule: only a single team can ever exist. The first user to
 * register bootstraps that team; subsequent users must join via invite.
 */
export async function createTeam(userId: number, name: string): Promise<Team | undefined> {
	const existingMembership = db
		.select({ teamId: teamUsers.teamId })
		.from(teamUsers)
		.where(eq(teamUsers.userId, userId))
		.get();

	if (existingMembership) {
		return undefined;
	}

	const anyTeam = db.select({ id: teams.id }).from(teams).limit(1).get();
	if (anyTeam) {
		throw new Error("Can't have multiple teams in self hosted version");
	}

	const created = db.insert(teams).values({ name }).returning().get();

	db.insert(teamUsers).values({ teamId: created.id, userId, role: 'ADMIN' }).run();

	return created;
}

export function updateTeam(teamId: number, data: { name?: string }) {
	return db
		.update(teams)
		.set({
			...(data.name !== undefined ? { name: data.name } : {})
		})
		.where(eq(teams.id, teamId))
		.returning()
		.get();
}

export function getInvitesForEmail(email: string) {
	return db
		.select({
			id: teamInvites.id,
			teamId: teamInvites.teamId,
			email: teamInvites.email,
			role: teamInvites.role,
			createdAt: teamInvites.createdAt,
			teamName: teams.name
		})
		.from(teamInvites)
		.innerJoin(teams, eq(teamInvites.teamId, teams.id))
		.where(eq(teamInvites.email, email.toLowerCase()))
		.all();
}

export function getUserTeams(userId: number) {
	return db
		.select({
			id: teams.id,
			name: teams.name,
			role: teamUsers.role,
			isActive: teams.isActive,
			dailyEmailLimit: teams.dailyEmailLimit,
			isBlocked: teams.isBlocked
		})
		.from(teams)
		.innerJoin(teamUsers, eq(teamUsers.teamId, teams.id))
		.where(eq(teamUsers.userId, userId))
		.all();
}

export async function getTeamUsers(teamId: number) {
	return db
		.select({
			teamId: teamUsers.teamId,
			userId: teamUsers.userId,
			role: teamUsers.role,
			user: users
		})
		.from(teamUsers)
		.innerJoin(users, eq(teamUsers.userId, users.id))
		.where(eq(teamUsers.teamId, teamId))
		.all();
}

export async function getTeamInvites(teamId: number): Promise<TeamInvite[]> {
	return db.select().from(teamInvites).where(eq(teamInvites.teamId, teamId)).all();
}

export async function createTeamInvite(
	teamId: number,
	email: string,
	role: Role
): Promise<TeamInvite> {
	if (!email) {
		throw new Error('Email is required');
	}

	const normalizedEmail = email.toLowerCase().trim();

	const { isLimitReached } = await checkTeamMemberLimit(teamId);
	if (isLimitReached) {
		throw new Error('Team invite limit reached');
	}

	const existingUser = db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).get();
	if (existingUser) {
		const membership = db
			.select({ userId: teamUsers.userId })
			.from(teamUsers)
			.where(eq(teamUsers.userId, existingUser.id))
			.get();
		if (membership) {
			throw new Error('User already part of a team');
		}
	}

	return db
		.insert(teamInvites)
		.values({
			id: cuid(),
			teamId,
			email: normalizedEmail,
			role
		})
		.returning()
		.get();
}

export async function deleteTeamInvite(teamId: number, inviteId: string): Promise<TeamInvite> {
	const invite = db
		.select()
		.from(teamInvites)
		.where(and(eq(teamInvites.teamId, teamId), eq(teamInvites.id, inviteId)))
		.get();

	if (!invite) {
		throw new Error('Invite not found');
	}

	db.delete(teamInvites).where(eq(teamInvites.id, invite.id)).run();
	return invite;
}

export async function updateTeamUserRole(teamId: number, userId: number, role: Role) {
	const teamUser = db
		.select()
		.from(teamUsers)
		.where(and(eq(teamUsers.teamId, teamId), eq(teamUsers.userId, userId)))
		.get();

	if (!teamUser) {
		throw new Error('Team member not found');
	}

	const adminCountRow = db
		.select({ value: sql<number>`count(*)` })
		.from(teamUsers)
		.where(and(eq(teamUsers.teamId, teamId), eq(teamUsers.role, 'ADMIN')))
		.get();
	const adminCount = adminCountRow?.value ?? 0;

	if (adminCount === 1 && teamUser.role === 'ADMIN' && role !== 'ADMIN') {
		throw new Error('Need at least one admin');
	}

	return db
		.update(teamUsers)
		.set({ role })
		.where(and(eq(teamUsers.teamId, teamId), eq(teamUsers.userId, userId)))
		.returning()
		.get();
}

export async function deleteTeamUser(
	teamId: number,
	userId: number,
	requestorRole: Role,
	requestorId: number
) {
	const teamUser = db
		.select()
		.from(teamUsers)
		.where(and(eq(teamUsers.teamId, teamId), eq(teamUsers.userId, userId)))
		.get();

	if (!teamUser) {
		throw new Error('Team member not found');
	}

	if (requestorRole !== 'ADMIN' && requestorId !== userId) {
		throw new Error('You are not authorized to delete this team member');
	}

	const adminCountRow = db
		.select({ value: sql<number>`count(*)` })
		.from(teamUsers)
		.where(and(eq(teamUsers.teamId, teamId), eq(teamUsers.role, 'ADMIN')))
		.get();
	const adminCount = adminCountRow?.value ?? 0;

	if (adminCount === 1 && teamUser.role === 'ADMIN') {
		throw new Error('Need at least one admin');
	}

	db.delete(teamUsers)
		.where(and(eq(teamUsers.teamId, teamId), eq(teamUsers.userId, userId)))
		.run();

	return teamUser;
}
