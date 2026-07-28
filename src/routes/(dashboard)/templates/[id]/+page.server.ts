import { error, fail, redirect } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { generateTemplateHtml } from '$lib/server/service/ai-template-service';
import {
	addAsset,
	getAsset,
	getDesignSystemBundle,
	upsertComponent
} from '$lib/server/service/design-system-service';
import { getDomain } from '$lib/server/service/domain-service';
import { sendEmail } from '$lib/server/service/email-service';
import {
	parseElementConfig,
	serializeElementConfig,
	type TemplateElementConfig
} from '$lib/template-element-config';
import {
	createElement,
	deleteElement,
	listElements,
	updateElement
} from '$lib/server/service/template-element-service';
import {
	hasTemplateComponents,
	listComponents,
	updateComponentSource
} from '$lib/server/service/template-component-service';
import { validateComponentSource } from '$lib/server/service/template-compile-service';
import { renderTemplateHtml } from '$lib/server/service/template-render-service';
import { deleteTemplate, getTemplate, updateTemplate } from '$lib/server/service/template-service';
import { templateElementTypes, type TemplateElementType } from '$lib/server/db/schema';
import { pickEmailLogos } from '$lib/design/extractTokens';
import { isPiConfigured } from '$lib/server/service/pi-service';
import type { Actions, PageServerLoad } from './$types';

const ELEMENT_TYPES = new Set<string>(templateElementTypes);
const IMAGE_TYPES = new Set<TemplateElementType>(['logo', 'image']);
const LINKISH_TYPES = new Set<TemplateElementType>(['button', 'cta', 'link']);

function configFromForm(type: TemplateElementType, form: FormData): TemplateElementConfig {
	const config: TemplateElementConfig = {};
	const text = String(form.get('text') ?? '').trim();
	const url = String(form.get('url') ?? '').trim();
	const assetId = String(form.get('assetId') ?? '').trim();

	if (type === 'text' || LINKISH_TYPES.has(type)) {
		if (text) config.text = text;
	}
	if (LINKISH_TYPES.has(type) && url) {
		config.url = url;
	}
	if (IMAGE_TYPES.has(type) && assetId) {
		config.assetId = assetId;
	}
	return config;
}

async function resolveAssetIdFromForm(
	teamId: number,
	type: TemplateElementType,
	form: FormData,
	existingAssetId?: string
): Promise<string | undefined> {
	if (!IMAGE_TYPES.has(type)) return undefined;

	const file = form.get('file');
	if (file instanceof File && file.size > 0) {
		const name =
			String(form.get('assetName') ?? '').trim() ||
			file.name.replace(/\.[^.]+$/, '') ||
			(type === 'logo' ? 'Logo' : 'Image');
		const asset = await addAsset(teamId, {
			kind: type === 'logo' ? 'logo' : 'image',
			name,
			filename: file.name || name,
			mime: file.type || 'application/octet-stream',
			bytes: new Uint8Array(await file.arrayBuffer())
		});
		return asset.id;
	}

	const assetId = String(form.get('assetId') ?? '').trim() || existingAssetId;
	if (!assetId) return undefined;

	const asset = getAsset(assetId, teamId);
	if (type === 'logo' && asset.kind !== 'logo') {
		throw new Error('Select a logo asset for logo elements');
	}
	if (type === 'image' && asset.kind !== 'image' && asset.kind !== 'logo') {
		throw new Error('Select an image or logo asset');
	}
	return asset.id;
}

function logoExtraProps(teamId: number, origin: string): Record<string, string> {
	const extra: Record<string, string> = {};
	const pair = pickEmailLogos(
		getDesignSystemBundle(teamId).assets.filter((a) => a.kind === 'logo')
	);
	if (pair) {
		const light = `${origin}/api/design-asset/${pair.light.id}`;
		const dark = `${origin}/api/design-asset/${pair.dark.id}`;
		extra.logo = light;
		extra.logo_url = light;
		extra.logo_light = light;
		extra.logo_dark = dark;
		extra.logo_dark_url = dark;
	}
	return extra;
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
				kind: a.kind as 'logo' | 'image'
			}));

		const components = listComponents(template.id, teamId, domainId);
		const componentBacked = components.length > 0;
		const legacyHtmlOnly = Boolean(template.html?.trim()) && !componentBacked;

		let renderedPreviewHtml: string | null = null;
		let renderError: string | null = null;
		if (componentBacked) {
			try {
				renderedPreviewHtml = await renderTemplateHtml({
					templateId: template.id,
					teamId,
					domainId,
					assetBaseUrl: url.origin,
					extraProps: logoExtraProps(teamId, url.origin)
				});
			} catch (e) {
				renderError = e instanceof Error ? e.message : 'Failed to render components';
			}
		}

		return {
			template,
			elements: listElements(template.id, teamId, domainId).map((el) => ({
				...el,
				parsedConfig: parseElementConfig(el.config)
			})),
			components: components.map((c) => ({
				id: c.id,
				name: c.name,
				kind: c.kind,
				source: c.source,
				order: c.order
			})),
			componentBacked,
			legacyHtmlOnly,
			renderedPreviewHtml,
			renderError,
			designReady: Boolean(
				bundle.system?.designMd?.trim() ||
					bundle.components.length > 0 ||
					bundle.assets.length > 0
			),
			designSummary: {
				hasMd: Boolean(bundle.system?.designMd?.trim()),
				assetCount: bundle.assets.length,
				componentCount: bundle.components.length
			},
			logoAssets: visualAssets.filter((a) => a.kind === 'logo'),
			imageAssets: visualAssets.filter((a) => a.kind === 'image'),
			visualAssets,
			previewFrom: domain ? `preview@${domain.name}` : null,
			domainVerified: domain?.status === 'SUCCESS',
			userEmail: locals.user?.email ?? null,
			piConfigured: isPiConfigured()
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
		if (!name || !subject) return fail(400, { error: 'Name and subject required' });

		try {
			updateTemplate(params.id, teamId, { name, subject }, domainId);
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

	addElement: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const type = String(form.get('type') ?? '').trim();
		const label = String(form.get('label') ?? '').trim();
		const required = form.get('required') === 'on';

		if (!ELEMENT_TYPES.has(type)) {
			return fail(400, { error: 'Invalid element type' });
		}
		if (!label) return fail(400, { error: 'Label is required' });

		const elementType = type as TemplateElementType;

		try {
			const config = configFromForm(elementType, form);
			const assetId = await resolveAssetIdFromForm(teamId, elementType, form);
			if (assetId) config.assetId = assetId;

			createElement({
				templateId: params.id,
				teamId,
				domainId,
				type: elementType,
				label,
				required,
				config: serializeElementConfig(config)
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Create failed' });
		}
		return { success: true, saved: 'element' as const };
	},

	updateElement: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const label = String(form.get('label') ?? '').trim();
		const required = form.get('required') === 'on';

		try {
			const existing = listElements(params.id, teamId, domainId).find((e) => e.id === id);
			if (!existing) return fail(404, { error: 'Element not found' });

			const config = configFromForm(existing.type, form);
			const assetId = await resolveAssetIdFromForm(
				teamId,
				existing.type,
				form,
				parseElementConfig(existing.config).assetId
			);
			if (assetId) config.assetId = assetId;

			updateElement(id, params.id, teamId, domainId, {
				label: label || existing.label,
				required,
				config: serializeElementConfig(config)
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		return { success: true, saved: 'element' as const };
	},

	deleteElement: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const id = String((await request.formData()).get('id') ?? '');
		try {
			deleteElement(id, params.id, teamId, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Delete failed' });
		}
		return { success: true };
	},

	generate: async ({ request, locals, params, url }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const prompt = String(form.get('prompt') ?? '');

		try {
			await generateTemplateHtml({
				teamId,
				domainId,
				templateId: params.id,
				prompt,
				assetBaseUrl: url.origin
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Generation failed' });
		}
		return { success: true, saved: 'generate' as const };
	},

	updateComponent: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const componentId = String(form.get('componentId') ?? '');
		const source = String(form.get('source') ?? '');

		try {
			const component = listComponents(params.id, teamId, domainId).find(
				(c) => c.id === componentId
			);
			if (!component) return fail(404, { error: 'Component not found' });
			validateComponentSource(component.name, source);
			updateComponentSource(componentId, params.id, teamId, domainId, source);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Update failed' });
		}
		return { success: true, saved: 'component' as const };
	},

	saveToLibrary: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const componentId = String(form.get('componentId') ?? '');
		const source = String(form.get('source') ?? '');
		const libraryName = String(form.get('libraryName') ?? '').trim();

		try {
			const template = getTemplate(params.id, teamId, domainId);
			const component = listComponents(params.id, teamId, domainId).find(
				(c) => c.id === componentId
			);
			if (!component) return fail(404, { error: 'Component not found' });
			if (!source.trim()) return fail(400, { error: 'Component source is empty' });

			validateComponentSource(component.name, source);

			const name =
				libraryName ||
				(component.kind === 'root' || component.name === 'Root'
					? `${template.name} layout`
					: component.name);

			const saved = upsertComponent(teamId, {
				name,
				description: `Svelte email component from template "${template.name}"`,
				html: source
			});

			return {
				success: true,
				saved: 'library' as const,
				libraryName: saved.name,
				libraryId: saved.id
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save to library' });
		}
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
			const componentBacked = hasTemplateComponents(template.id);
			if (!componentBacked && !template.html?.trim()) {
				return fail(400, { error: 'Generate the template before sending a preview' });
			}

			const domain = await getDomain(domainId, teamId);
			if (domain.status !== 'SUCCESS') {
				return fail(400, { error: 'Domain must be verified before sending' });
			}

			const origin = url.origin;
			const variables = logoExtraProps(teamId, origin);

			const email = await sendEmail({
				teamId,
				from: `preview@${domain.name}`,
				to,
				subject: template.subject,
				templateId: template.id,
				variables,
				assetBaseUrl: origin
			});

			if (email.latestStatus === 'SUPPRESSED') {
				return fail(400, {
					error: 'Recipient is on the suppression list',
					emailId: email.id
				});
			}

			return { success: true, saved: 'preview' as const, emailId: email.id };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Send failed' });
		}
	}
};
