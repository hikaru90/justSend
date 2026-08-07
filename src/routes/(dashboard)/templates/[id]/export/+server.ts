import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { renderTemplateForSend } from '$lib/server/service/email-service';
import { pickEmailLogo, parseDesignTokenMap } from '$lib/design/extractTokens';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import { getTemplate } from '$lib/server/service/template-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId ?? undefined;

	try {
		const template = getTemplate(params.id, teamId, domainId);

		const origin = url.origin;
		const variables: Record<string, string> = {};
		const bundle = getDesignSystemBundle(teamId);
		const logo = pickEmailLogo(bundle.assets.filter((a) => a.kind === 'logo'));
		if (logo) {
			const src = `${origin}/api/design-asset/${logo.id}`;
			variables.logo = src;
			variables.logo_url = src;
		}

		const html = renderTemplateForSend(
			{ content: template.content, html: template.html },
			{
				variables,
				origin,
				tokens: parseDesignTokenMap(bundle.system?.designMd ?? ''),
			},
		);

		if (!html.trim()) {
			error(404, 'Compose the email before exporting');
		}

		const download = url.searchParams.get('download') === '1';
		const filename = `${template.name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'template'}.html`;

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				...(download
					? {
							'Content-Disposition': `attachment; filename="${filename}"`,
						}
					: { 'Cache-Control': 'no-store' }),
			},
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		error(400, e instanceof Error ? e.message : 'Export failed');
	}
};
