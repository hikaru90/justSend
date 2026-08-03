import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../../../tests/helpers/db';
import {
	createTeam,
	createDomain,
	createContactBook,
	createContact,
} from '../../../tests/helpers/factories';
import {
	getContactBooks,
	getContactBook,
	createContactBook as createBook,
	updateContactBook,
	deleteContactBook,
} from './contact-book-service';

describe('contact-book-service', () => {
	beforeEach(() => resetDb());

	it('creates a contact book with normalized variables', () => {
		const team = createTeam();

		const book = createBook(team.id, 'Newsletter', [' name ', 'name', 'email', '']);

		expect(book.teamId).toBe(team.id);
		expect(book.name).toBe('Newsletter');
		expect(JSON.parse(book.variables)).toEqual(['name', 'email']);
		expect(book.doubleOptInEnabled).toBe(true);
	});

	it('lists and gets contact books with contact counts', () => {
		const team = createTeam();
		const book1 = createContactBook(team.id, { name: 'Alpha List' });
		const book2 = createContactBook(team.id, { name: 'Beta List' });
		createContact(book1.id);
		createContact(book1.id);

		const listed = getContactBooks(team.id, 'Alpha');
		expect(listed).toHaveLength(1);
		expect(listed[0].name).toBe('Alpha List');
		expect(listed[0].contactCount).toBe(2);

		const fetched = getContactBook(book2.id, team.id);
		expect(fetched.name).toBe('Beta List');
		expect(fetched.contactCount).toBe(0);
	});

	it('throws Contact book not found for wrong team or missing id', () => {
		const team1 = createTeam();
		const team2 = createTeam();
		const book = createContactBook(team1.id);

		expect(() => getContactBook(book.id, team2.id)).toThrow('Contact book not found');
		expect(() => getContactBook('missing', team1.id)).toThrow('Contact book not found');
	});

	it('updates a contact book', async () => {
		const team = createTeam();
		const book = createContactBook(team.id, { name: 'Old Name' });

		const updated = await updateContactBook(book.id, team.id, {
			name: 'New Name',
			variables: ['firstName'],
			doubleOptInEnabled: false,
		});

		expect(updated.name).toBe('New Name');
		expect(JSON.parse(updated.variables)).toEqual(['firstName']);
		expect(updated.doubleOptInEnabled).toBe(false);
	});

	it('validates double opt-in content placeholder when custom content is provided', async () => {
		const team = createTeam();
		const book = createContactBook(team.id, { doubleOptInEnabled: false });

		await expect(
			updateContactBook(book.id, team.id, {
				doubleOptInEnabled: true,
				doubleOptInContent: '<p>Confirm your subscription</p>',
			}),
		).rejects.toThrow(
			'Double opt-in email content must include the {{doubleOptInUrl}} placeholder',
		);

		const ok = await updateContactBook(book.id, team.id, {
			doubleOptInEnabled: true,
			doubleOptInContent: '<p>Click {{doubleOptInUrl}} to confirm</p>',
		});

		expect(ok.doubleOptInContent).toContain('{{doubleOptInUrl}}');
	});

	it('validates doubleOptInFrom against a verified team domain', async () => {
		const team = createTeam();
		const domain = createDomain(team.id);
		const book = createContactBook(team.id);

		const updated = await updateContactBook(book.id, team.id, {
			doubleOptInFrom: `noreply@${domain.name}`,
		});

		expect(updated.doubleOptInFrom).toBe(`noreply@${domain.name}`);
	});

	it('deletes a contact book', () => {
		const team = createTeam();
		const book = createContactBook(team.id);

		const deleted = deleteContactBook(book.id, team.id);

		expect(deleted.id).toBe(book.id);
		expect(() => getContactBook(book.id, team.id)).toThrow('Contact book not found');
	});
});
