import { error, fail, redirect } from '@sveltejs/kit';
import { requireTeamId } from '$lib/server/dashboard';
import { generateScaffold } from '$lib/server/service/ai-template-service';
import {
	addAsset,
	getAsset,
	getComponent,
	getDesignSystemBundle,
	parseComponentProps,
	parseComponentSlots
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
	reorderElements,
	updateElement
} from '$lib/server/service/template-element-service';
import {
	composeEmailSections,
	parseScaffoldContent,
	serializeScaffoldContent
} from '$lib/server/service/template-compose-service';
import {
	documentFromComposedHtml,
	documentFromComposedSections,
	parseEmailBuilderContent,
	renderEmailHtml,
	serializeEmailBuilderContent,
	EMPTY_DOCUMENT
} from '$lib/email-builder/render';
import { deleteTemplate, getTemplate, updateTemplate } from '$lib/server/service/template-service';
import { templateElementTypes, type TemplateElementType } from '$lib/server/db/schema';
import { pickEmailLogos, extractDesignTokens, hexForColorInput } from '$lib/design/extractTokens';
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
	const designComponentId = String(form.get('designComponentId') ?? '').trim();

	if (type === 'component') {
		if (designComponentId) config.designComponentId = designComponentId;
		return config;
	}

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

		const parsedContent = parseEmailBuilderContent(template.content);
		const scaffold = parsedContent.scaffold.slots
			? parsedContent.scaffold
			: parseScaffoldContent(template.content);
		const hasHtml = Boolean(template.html?.trim());
		const emailDocument =
			parsedContent.document ??
			(template.html?.trim() ? documentFromComposedHtml(template.html) : EMPTY_DOCUMENT);

		return {
			template,
			elements: listElements(template.id, teamId, domainId).map((el) => ({
				...el,
				parsedConfig: parseElementConfig(el.config)
			})),
			scaffold,
			emailDocument,
			hasHtml,
			previewHtml: template.html ?? null,
		designReady: Boolean(
			bundle.system?.designMd?.trim() ||
				bundle.components.length > 0 ||
				bundle.assets.length > 0
		),
		designColors: extractDesignTokens(bundle.system?.designMd ?? '').colors.map(hexForColorInput),
			designSummary: {
				hasMd: Boolean(bundle.system?.designMd?.trim()),
				assetCount: bundle.assets.length,
				componentCount: bundle.components.length
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
				parsedSlots: parseComponentSlots(c)
			})),
			logoAssets: visualAssets.filter((a) => a.kind === 'logo'),
			imageAssets: visualAssets.filter((a) => a.kind === 'image'),
			visualAssets,
			previewFrom: domain ? `preview@${domain.name}` : null,
			domainVerified: domain?.status === 'SUCCESS',
			userEmail: locals.user?.email ?? null,
			piConfigured: isPiConfigured(),
			assetBaseUrl: url.origin
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
			if (elementType === 'component') {
				if (!config.designComponentId) {
					return fail(400, { error: 'Select a design-system component' });
				}
				getComponent(config.designComponentId, teamId);
			} else {
				const assetId = await resolveAssetIdFromForm(teamId, elementType, form);
				if (assetId) config.assetId = assetId;
			}

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

	addElements: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const required = form.get('required') !== 'off';
		const ids = form
			.getAll('designComponentId')
			.map((v) => String(v).trim())
			.filter(Boolean);

		if (ids.length === 0) {
			return fail(400, { error: 'Select at least one design-system component' });
		}

		const uniqueIds = [...new Set(ids)];

		try {
			let added = 0;
			for (const designComponentId of uniqueIds) {
				const component = getComponent(designComponentId, teamId);
				createElement({
					templateId: params.id,
					teamId,
					domainId,
					type: 'component',
					label: component.name,
					required,
					config: serializeElementConfig({ designComponentId })
				});
				added += 1;
			}

			return { success: true, saved: 'element' as const, added };
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Create failed' });
		}
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
			if (existing.type === 'component') {
				if (!config.designComponentId) {
					return fail(400, { error: 'Select a design-system component' });
				}
				getComponent(config.designComponentId, teamId);
			} else {
				const assetId = await resolveAssetIdFromForm(
					teamId,
					existing.type,
					form,
					parseElementConfig(existing.config).assetId
				);
				if (assetId) config.assetId = assetId;
			}

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

	reorderElements: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const orderedIds = form
			.getAll('orderedId')
			.map((v) => String(v).trim())
			.filter(Boolean);

		try {
			reorderElements(params.id, teamId, domainId, orderedIds);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Reorder failed' });
		}
		return { success: true, saved: 'element' as const };
	},

	scaffold: async ({ request, locals, params, url }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const prompt = String(form.get('prompt') ?? '');

		try {
			await generateScaffold({
				teamId,
				domainId,
				templateId: params.id,
				prompt,
				assetBaseUrl: url.origin
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Scaffold failed' });
		}
		return { success: true, saved: 'scaffold' as const };
	},

	saveSlots: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const preheader = String(form.get('preheader') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim();

		try {
			const template = getTemplate(params.id, teamId, domainId);
			const existing = parseScaffoldContent(template.content);
			const slots: Record<string, string> = { ...existing.slots };

			for (const [key, value] of form.entries()) {
				if (typeof value !== 'string') continue;
				if (key === 'preheader' || key === 'subject' || key === 'prompt') continue;
				if (key.startsWith('slot_')) {
					slots[key.slice(5)] = value;
				}
			}

			updateTemplate(
				params.id,
				teamId,
				{
					content: serializeScaffoldContent({
						subject: subject || existing.subject,
						preheader: preheader || existing.preheader,
						slots
					}),
					...(subject ? { subject } : {})
				},
				domainId
			);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
		return { success: true, saved: 'slots' as const };
	},

	compose: async ({ locals, params, url }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;

		try {
			const template = getTemplate(params.id, teamId, domainId);
			const bundle = getDesignSystemBundle(teamId);
			const elements = listElements(params.id, teamId, domainId);
			if (elements.length === 0) {
				return fail(400, { error: 'Add at least one section before composing' });
			}

			const composeInput = {
				template,
				elements,
				components: bundle.components,
				assets: bundle.assets,
				assetBaseUrl: url.origin,
				extraSlots: logoExtraProps(teamId, url.origin)
			};
			const sections = composeEmailSections(composeInput);
			const existing = parseEmailBuilderContent(template.content);
			const document = documentFromComposedSections(sections);
			const content = serializeEmailBuilderContent(document, existing.scaffold);
			const rendered = renderEmailHtml(document);

			updateTemplate(params.id, teamId, { html: rendered, content }, domainId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Compose failed' });
		}
		return { success: true, saved: 'compose' as const };
	},

	saveHtml: async ({ request, locals, params }) => {
		const teamId = requireTeamId(locals.teamId);
		const domainId = locals.domainId ?? undefined;
		const form = await request.formData();
		const html = String(form.get('html') ?? '');
		const documentJson = String(form.get('document') ?? '');

		try {
			const template = getTemplate(params.id, teamId, domainId);
			const existing = parseEmailBuilderContent(template.content);

			if (documentJson.trim()) {
				const document = JSON.parse(documentJson) as Parameters<
					typeof serializeEmailBuilderContent
				>[0];
				const content = serializeEmailBuilderContent(document, existing.scaffold);
				const rendered = html.trim() || renderEmailHtml(document);
				updateTemplate(params.id, teamId, { html: rendered, content }, domainId);
			} else if (html.trim()) {
				updateTemplate(params.id, teamId, { html }, domainId);
			} else {
				return fail(400, { error: 'Nothing to save' });
			}
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Save failed' });
		}
		return { success: true, saved: 'html' as const };
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
				return fail(400, { error: 'Compose the email before sending a preview' });
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
				bytes: new Uint8Array(await file.arrayBuffer())
			});
			return {
				success: true,
				saved: 'asset' as const,
				asset: { id: asset.id, name: asset.name, kind: asset.kind }
			};
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Upload failed' });
		}
	}
};
