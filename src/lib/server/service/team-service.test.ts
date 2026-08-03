import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import {
	createTeam as createTeamFactory,
	createUser,
	addUserToTeam,
} from '../../../tests/helpers/factories';
import {
	createTeam,
	createTeamInvite,
	deleteTeamInvite,
	deleteTeamUser,
	getTeamInvites,
	getTeamUsers,
	getUserTeams,
	updateTeam,
	updateTeamUserRole,
} from './team-service';

beforeEach(() => resetDb());

describe('team-service', () => {
	describe('createTeam', () => {
		it('creates the first team for a user', async () => {
			const user = createUser();
			const team = await createTeam(user.id, 'My Team');
			expect(team).toBeDefined();
			expect(team!.name).toBe('My Team');

			const teams = getUserTeams(user.id);
			expect(teams).toHaveLength(1);
			expect(teams[0].role).toBe('ADMIN');
		});

		it('returns undefined when the same user tries to create a second team', async () => {
			const user = createUser();
			await createTeam(user.id, 'Team One');
			const second = await createTeam(user.id, 'Team Two');
			expect(second).toBeUndefined();
		});

		it('throws when a second user tries to create a team while one already exists', async () => {
			const user1 = createUser();
			const user2 = createUser();
			await createTeam(user1.id, 'First Team');

			await expect(createTeam(user2.id, 'Second Team')).rejects.toThrow(
				"Can't have multiple teams in self hosted version",
			);
		});
	});

	describe('createTeamInvite', () => {
		it('creates an invite for a new email', async () => {
			const user = createUser();
			const team = createTeamFactory();
			addUserToTeam(team.id, user.id);

			const invite = await createTeamInvite(team.id, 'NewMember@Example.com', 'MEMBER');
			expect(invite.email).toBe('newmember@example.com');
			expect(invite.role).toBe('MEMBER');
		});

		it('throws when email is empty', async () => {
			const team = createTeamFactory();
			await expect(createTeamInvite(team.id, '', 'MEMBER')).rejects.toThrow('Email is required');
		});
	});

	describe('deleteTeamInvite', () => {
		it('deletes an existing invite', async () => {
			const team = createTeamFactory();
			const invite = await createTeamInvite(team.id, 'invite@example.com', 'MEMBER');

			const deleted = await deleteTeamInvite(team.id, invite.id);
			expect(deleted.id).toBe(invite.id);
			const invites = await getTeamInvites(team.id);
			expect(invites).toHaveLength(0);
		});

		it('throws when invite is not found', async () => {
			const team = createTeamFactory();
			await expect(deleteTeamInvite(team.id, 'missing')).rejects.toThrow('Invite not found');
		});
	});

	describe('updateTeamUserRole', () => {
		it('updates a member role', async () => {
			const team = createTeamFactory();
			const admin = createUser();
			const member = createUser();
			addUserToTeam(team.id, admin.id, 'ADMIN');
			addUserToTeam(team.id, member.id, 'MEMBER');

			const updated = await updateTeamUserRole(team.id, member.id, 'ADMIN');
			expect(updated.role).toBe('ADMIN');
		});

		it('throws when demoting the last admin', async () => {
			const team = createTeamFactory();
			const admin = createUser();
			addUserToTeam(team.id, admin.id, 'ADMIN');

			await expect(updateTeamUserRole(team.id, admin.id, 'MEMBER')).rejects.toThrow(
				'Need at least one admin',
			);
		});
	});

	describe('deleteTeamUser', () => {
		it('allows an admin to remove a member', async () => {
			const team = createTeamFactory();
			const admin = createUser();
			const member = createUser();
			addUserToTeam(team.id, admin.id, 'ADMIN');
			addUserToTeam(team.id, member.id, 'MEMBER');

			const removed = await deleteTeamUser(team.id, member.id, 'ADMIN', admin.id);
			expect(removed.userId).toBe(member.id);
			expect((await getTeamUsers(team.id)).map((u) => u.userId)).not.toContain(member.id);
		});

		it('throws when removing the last admin', async () => {
			const team = createTeamFactory();
			const admin = createUser();
			addUserToTeam(team.id, admin.id, 'ADMIN');

			await expect(deleteTeamUser(team.id, admin.id, 'ADMIN', admin.id)).rejects.toThrow(
				'Need at least one admin',
			);
		});
	});

	describe('getUserTeams', () => {
		it('returns teams for a user', async () => {
			const user = createUser();
			const team = await createTeam(user.id, 'Solo Team');
			const teams = getUserTeams(user.id);
			expect(teams).toHaveLength(1);
			expect(teams[0].id).toBe(team!.id);
		});
	});

	describe('getTeamUsers', () => {
		it('returns all members of a team', async () => {
			const team = createTeamFactory();
			const user1 = createUser();
			const user2 = createUser();
			addUserToTeam(team.id, user1.id, 'ADMIN');
			addUserToTeam(team.id, user2.id, 'MEMBER');

			const users = await getTeamUsers(team.id);
			expect(users).toHaveLength(2);
		});
	});

	describe('getTeamInvites', () => {
		it('returns pending invites', async () => {
			const team = createTeamFactory();
			await createTeamInvite(team.id, 'a@example.com', 'MEMBER');
			await createTeamInvite(team.id, 'b@example.com', 'ADMIN');

			const invites = await getTeamInvites(team.id);
			expect(invites).toHaveLength(2);
		});
	});

	describe('updateTeam', () => {
		it('updates team name', () => {
			const team = createTeamFactory({ name: 'Old Name' });
			const updated = updateTeam(team.id, { name: 'New Name' });
			expect(updated.name).toBe('New Name');
		});
	});
});
