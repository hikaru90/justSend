import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import { createTeam, createTemplate as createTemplateRow } from '../../../tests/helpers/factories';
import {
	listTemplates,
	getTemplate,
	createTemplate,
	updateTemplate,
	deleteTemplate,
} from './template-service';
import { db } from '../db';
import { templates } from '../db/schema';
import { eq } from 'drizzle-orm';

describe('template-service', () => {
	beforeEach(() => resetDb());

	it('creates a template for a team', () => {
		const team = createTeam();

		const template = createTemplate({
			teamId: team.id,
			name: 'Welcome',
			subject: 'Hello {{name}}',
			html: '<p>Hi {{name}}</p>',
		});

		expect(template.teamId).toBe(team.id);
		expect(template.name).toBe('Welcome');
		expect(template.subject).toBe('Hello {{name}}');
		expect(template.html).toBe('<p>Hi {{name}}</p>');
	});

	it('lists templates scoped to the team', () => {
		const team1 = createTeam();
		const team2 = createTeam();
		createTemplate({ teamId: team1.id, name: 'A', subject: 'S1' });
		createTemplate({ teamId: team1.id, name: 'B', subject: 'S2' });
		createTemplate({ teamId: team2.id, name: 'Other', subject: 'S3' });

		const listed = listTemplates(team1.id);

		expect(listed).toHaveLength(2);
		expect(listed.every((t) => t.teamId === team1.id)).toBe(true);
	});

	it('gets a template by id for the owning team', () => {
		const team = createTeam();
		const created = createTemplate({
			teamId: team.id,
			name: 'Fetch Me',
			subject: 'Subject',
		});

		const fetched = getTemplate(created.id, team.id);

		expect(fetched.id).toBe(created.id);
		expect(fetched.name).toBe('Fetch Me');
	});

	it('throws Template not found for wrong team or missing id', () => {
		const team1 = createTeam();
		const team2 = createTeam();
		const template = createTemplateRow(team1.id);

		expect(() => getTemplate(template.id, team2.id)).toThrow('Template not found');
		expect(() => getTemplate('missing-id', team1.id)).toThrow('Template not found');
	});

	it('updates a template', () => {
		const team = createTeam();
		const created = createTemplate({
			teamId: team.id,
			name: 'Old',
			subject: 'Old Subject',
			html: '<p>Old</p>',
		});

		const updated = updateTemplate(created.id, team.id, {
			name: 'New',
			subject: 'New Subject',
			html: '<p>New</p>',
		});

		expect(updated.name).toBe('New');
		expect(updated.subject).toBe('New Subject');
		expect(updated.html).toBe('<p>New</p>');
	});

	it('normalizes and updates tags', () => {
		const team = createTeam();
		const created = createTemplate({
			teamId: team.id,
			name: 'Tagged',
			subject: 'Subject',
		});

		const updated = updateTemplate(created.id, team.id, {
			tags: [' Welcome ', 'welcome', 'Onboarding', ''],
		});

		expect(updated.tags).toBe(JSON.stringify(['welcome', 'onboarding']));
		const listed = listTemplates(team.id);
		expect(listed[0].tagList).toEqual(['welcome', 'onboarding']);
	});

	it('deletes a template', () => {
		const team = createTeam();
		const created = createTemplate({
			teamId: team.id,
			name: 'Delete Me',
			subject: 'Bye',
		});

		const deleted = deleteTemplate(created.id, team.id);

		expect(deleted.id).toBe(created.id);
		expect(db.select().from(templates).where(eq(templates.id, created.id)).get()).toBeUndefined();
	});
});
