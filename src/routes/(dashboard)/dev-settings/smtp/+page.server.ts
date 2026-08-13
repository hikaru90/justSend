import type { PageServerLoad } from './$types';
import { env } from '$lib/server/env';

export const load: PageServerLoad = async () => {
	return {
		hostUrl: env.HOST_URL,
	};
};
