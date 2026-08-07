import { error, fail, redirect } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import {
	addAsset,
	getAsset,
	getComponent,
	getDesignSystemBundle,
	listOwlSectionComponents,
	parseComponentProps,
	parseComponentSlots,
	upsertOwlSectionComponent,
} from '$lib/server/service/design-system-service';
import { getDomain } from '$lib/server/service/domain-service';
import { sendEmail } from '$lib/server/service/email-service';
import {
	compileOwlDoc,
	migrateToOwlDoc,
} from '$lib/email/owl/studio-server';
import { parseOwlDoc, serializeOwlDoc, parseTemplateStudioSnapshot, serializeTemplateStudioSnapshot } from '$lib/email/owl/studio';
import { STARTERS } from '$lib/email/owl/starters';
import { relativizeDesignAssetUrls } from '$lib/design-asset-urls';
import { deleteTemplate, getTemplate, updateTemplate } from '$lib/server/service/template-service';
import { pickEmailLogo, extractDesignTokens, hexForColorInput, parseDesignTokenMap } from '$lib/design/extractTokens';
import { isPiConfigured } from '$lib/server/service/pi-service';
import type { Actions, PageServerLoad } from './$types';

function logoExtraProps(teamId: number, origin = ''): Record<string, string> {
	const extra: Record<string, string> = {};
	const logo = pickEmailLogo(
		getDesignSystemBundle(teamId).assets.filter((a) => a.kind === 'logo'),
	);
	if (logo) {
		const base = origin.replace(/\/$/, '');
		const src = base ? `${base}/api/design-asset/${logo.id}` : `/api/design-asset/${logo.id}`;
		extra.logo = src;
		extra.logo_url = src;
	}
	return extra;
}

function designTokensForTeam(teamId: number): Record<string, string> {
	const bundle = getDesignSystemBundle(teamId);
	return parseDesignTokenMap(bundle.system?.designMd ?? '');
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const teamId = requireTeamId(locals.teamId);
	const domainId = locals.domainId ?? undefined;
	const bundle = getDesignSystemBundle(teamId);

	const domain = locals.domainId
		? await getDomain(locals.domainId, teamId).catch(() => null)
		: null;

	try {
		const template = getTemplate(params.id, teamId, domainId);
		const visualAssets = bundle.assets
			.filter((a) => a.kind === 'logo' || a.kind === 'image')
			.map((a) => ({
				id: a.id,
				name: a.name,
				filename: a.filename,
				kind: a.kind as 'logo' | 'image',
			}));

		const content = relativizeDesignAssetUrls(template.content ?? '');
		const html = template.html ? relativizeDesignAssetUrls(template.html) : template.html;
		const owlParsed = parseOwlDoc(content);
		const owlMigration = owlParsed
			? null
			: migrateToOwlDoc({
					content,
					html,
				});

		const studioSnapshot = parseTemplateStudioSnapshot(template.designSnapshot);

		return {
			template: { ...template, content, html },
			studioSnapshot,
			owlDoc: owlParsed ?? owlMigration?.doc ?? null,
			owlMigrated: owlMigration?.migrated ?? false,
			owlMigrationNote: owlMigration?.note ?? null,
			owlStarters: STARTERS.map((s) => ({
				key: s.key,
				name: s.name,
				role: s.role,
				description: s.description,
				html: s.html,
			})),
			owlDesignSections: listOwlSectionComponents(teamId).map((c) => ({
				id: c.id,
				name: c.name,
				description: c.description,
				starterKey: c.starterKey,
				html: c.html,
			})),
			designReady: Boolean(
				bundle.system?.designMd?.trim() || bundle.components.length > 0 || bundle.assets.length > 0,
			),
			designColors: extractDesignTokens(bundle.system?.designMd ?? '').colors.map(hexForColorInput),
			designTokens: parseDesignTokenMap(bundle.system?.designMd ?? ''),
			designSummary: {
				hasMd: Boolean(bundle.system?.designMd?.trim()),
				assetCount: bundle.assets.length,
				componentCount: bundle.components.length,
			},
			designComponents: bundle.components.map((c) => ({
				id: c.id,
				name: c.name,
				kind: c.kind,
				role: c.role,
				description: c.description,
				starterKey: c.starterKey,
				html: c.html,
				document: c.document ?? '',
				props: parseComponentProps(c),
				parsedSlots: parseComponentSlots(c),
			})),
			logoAssets: visualAssets.filter((a) => a.kind === 'logo'),
			imageAssets: visualAssets.filter((a) => a.kind === 'image'),
			visualAssets,
			previewFrom: domain ? `preview@${domain.name}` : null,
			domainVerified: domain?.status === 'SUCCESS',
			userEmail: locals.user?.email ?? null,
			piConfigured: isPiConfigured(),
			assetBaseUrl: url.origin,
		};
	} catch {
		error(404, 'Template not found');
	}
};

export const actions: Actions = {
	updateMeta: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const prompt = String(form.get('prompt') ?? '').trim();
		if (!name || !subject) return fail(400, { error: 'Name and subject required' });

		try {
			updateTemplate(params.id, teamId, { name, subject, prompt: prompt || null }, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		return { success: true, saved: 'meta' as const };
	},

	delete: async ({ locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		try {
			deleteTemplate(params.id, teamId, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		redirect(302, '/templates');
	},

	sendPreview: async ({ request, locals, params, url }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId;
		if (!domainId) return fail(400, { error: 'Select a domain to send a preview' });

		const form = await request.formData();
		const to = String(form.get('to') ?? '').trim();
		if (!to) return fail(400, { error: 'Recipient email is required' });

		try {
			const template = getTemplate(params.id, teamId, domainId);
			if (!template.html?.trim()) {
				return fail(400, { error: 'Save the email before sending a preview' });
			}

			const domain = await getDomain(domainId, teamId);
			if (domain.status !== 'SUCCESS') {
				return fail(400, { error: 'Domain must be verified before sending' });
			}

			const origin = url.origin;
			const variables = logoExtraProps(teamId, origin);
			for (const key of ['email', 'firstName', 'lastName'] as const) {
				const value = String(form.get(key) ?? '').trim();
				if (value) variables[key] = value;
			}

			const email = await sendEmail({
				teamId,
				from: `preview@${domain.name}`,
				to,
				subject: template.subject,
				templateId: template.id,
				variables,
				assetBaseUrl: origin,
			});

			if (email.latestStatus === 'SUPPRESSED') {
				return fail(400, {
					error: 'Recipient is on the suppression list',
					emailId: email.id,
				});
			}

			return { success: true, saved: 'preview' as const, emailId: email.id };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Send failed' });
		}
	},

	uploadAsset: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const file = form.get('file');
		const nameRaw = String(form.get('name') ?? '').trim();

		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'File is required' });
		}
		const name = nameRaw || file.name || 'image';
		try {
			const asset = await addAsset(teamId, {
				kind: 'image',
				name,
				filename: file.name || name,
				mime: file.type || 'application/octet-stream',
				bytes: new Uint8Array(await file.arrayBuffer()),
			});
			return {
				success: true,
				saved: 'asset' as const,
				asset: { id: asset.id, name: asset.name, kind: asset.kind },
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Upload failed' });
		}
	},

	owlCompile: async ({ request, locals, url }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const raw = String(form.get('doc') ?? '');
		const doc = parseOwlDoc(raw);
		if (!doc) return fail(400, { error: 'Invalid owl document' });

		try {
			return compileOwlDoc(doc, {
				origin: url.origin,
				tokens: designTokensForTeam(teamId),
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Compile failed' });
		}
	},

	saveTemplate: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();
		const prompt = String(form.get('prompt') ?? '').trim();
		const raw = String(form.get('doc') ?? '');
		const doc = parseOwlDoc(raw);
		if (!name || !subject) return fail(400, { error: 'Name and subject required' });
		if (!doc) return fail(400, { error: 'Invalid owl document' });

		const testVariables: Record<string, string> = {};
		for (const key of ['email', 'firstName', 'lastName'] as const) {
			const value = String(form.get(key) ?? '').trim();
			if (value) testVariables[key] = value;
		}

		try {
			const preview = compileOwlDoc(doc, { tokens: designTokensForTeam(teamId) });
			updateTemplate(
				params.id,
				teamId,
				{
					name,
					subject,
					prompt: prompt || null,
					content: serializeOwlDoc(doc),
					html: relativizeDesignAssetUrls(preview.html),
					designSnapshot: serializeTemplateStudioSnapshot({ testVariables }),
				},
				domainId,
			);
			const errorCount = preview.issues.filter((i) => i.severity === 'error').length;
			return { success: true, saved: 'template' as const, errorCount };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
	},

	owlSave: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const raw = String(form.get('doc') ?? '');
		const doc = parseOwlDoc(raw);
		if (!doc) return fail(400, { error: 'Invalid owl document' });

		try {
			const preview = compileOwlDoc(doc, { tokens: designTokensForTeam(teamId) });
			updateTemplate(
				params.id,
				teamId,
				{
					content: serializeOwlDoc(doc),
					html: relativizeDesignAssetUrls(preview.html),
				},
				domainId,
			);
			const errorCount = preview.issues.filter((i) => i.severity === 'error').length;
			return { success: true, saved: 'owl' as const, errorCount };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
	},

	saveOwlComponent: async ({ request, locals }) => {
		const teamId = requireTeamId(locals.teamId);
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim() || undefined;
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;
		const html = String(form.get('html') ?? '');
		const componentKey = String(form.get('componentKey') ?? '').trim() || undefined;

		if (!name) return fail(400, { error: 'Component name is required' });
		if (!html.trim()) return fail(400, { error: 'Section HTML is required' });

		try {
			const component = upsertOwlSectionComponent(teamId, {
				id,
				name,
				description,
				html,
				componentKey,
			});
			return {
				success: true,
				saved: 'owlComponent' as const,
				component: {
					id: component.id,
					name: component.name,
					description: component.description,
					html: component.html,
				},
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
	},
};
