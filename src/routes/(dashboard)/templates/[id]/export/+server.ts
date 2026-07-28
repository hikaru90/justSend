import { error } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { pickEmailLogos } from '$lib/design/extractTokens';
import { getDesignSystemBundle } from '$lib/server/service/design-system-service';
import { hasTemplateComponents } from '$lib/server/service/template-component-service';
import { renderTemplateHtml } from '$lib/server/service/template-render-service';
import { getTemplate } from '$lib/server/service/template-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId ?? undefined;

	try {
		const template = getTemplate(params.id, teamId, domainId);
		if (!hasTemplateComponents(template.id)) {
			error(404, 'Template has no Svelte components');
		}

		const origin = url.origin;
		const extraProps: Record<string, string> = {};
		const pair = pickEmailLogos(
			getDesignSystemBundle(teamId).assets.filter((a) => a.kind === 'logo')
		);
		if (pair) {
			const light = `${origin}/api/design-asset/${pair.light.id}`;
			const dark = `${origin}/api/design-asset/${pair.dark.id}`;
			extraProps.logo = light;
			extraProps.logo_url = light;
			extraProps.logo_light = light;
			extraProps.logo_dark = dark;
			extraProps.logo_dark_url = dark;
		}

		const html = await renderTemplateHtml({
			templateId: template.id,
			teamId,
			domainId,
			assetBaseUrl: origin,
			extraProps
		});

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
		error(400, e instanceof Error ? e.message : 'Render failed');
	}
};
