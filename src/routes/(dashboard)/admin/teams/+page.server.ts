import { db } from '$lib/server/db';
import { teams } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { teams: db.select().from(teams).all() };
};
