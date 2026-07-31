import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { replaceVariables } from '$lib/server/service/email-service';
import { pickEmailLogos } from '$lib/design/extractTokens';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import { getTemplate } from '$lib/server/service/template-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId ?? undefined;

	try {
		const template = getTemplate(params.id, teamId, domainId);
		if (!template.html?.trim()) {
			error(404, 'Compose the email before exporting');
		}

		const origin = url.origin;
		const variables: Record<string, string> = {};
		const pair = pickEmailLogos(
			getDesignSystemBundle(teamId).assets.filter((a) => a.kind === 'logo')
		);
		if (pair) {
			const light = `${origin}/api/design-asset/${pair.light.id}`;
			const dark = `${origin}/api/design-asset/${pair.dark.id}`;
			variables.logo = light;
			variables.logo_url = light;
			variables.logo_light = light;
			variables.logo_dark = dark;
			variables.logo_dark_url = dark;
		}

		const html = replaceVariables(template.html, variables);

		const download = url.searchParams.get('download') === '1';
		const filename = `${template.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'template'}.html`;

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				...(download
					? {
							'Content-Disposition': `attachment; filename="${filename}"`
						}
					: { 'Cache-Control': 'no-store' })
			}
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(400, e instanceof Error ? e.message : 'Export failed');
	}
};
