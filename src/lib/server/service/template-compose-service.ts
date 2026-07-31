import { pickEmailLogos } from '$lib/design/extractTokens';
import {
	elementSlug,
	parseElementConfig,
	type TemplateElementType
} from '$lib/template-element-config';
import { parseComponentProps, type DesignAsset, type DesignComponent } from './design-system-service';
import type { TemplateElement } from './template-element-service';
import type { Template } from './template-service';

export type ScaffoldContent = {
	subject?: string;
	preheader?: string;
	slots: Record<string, string>;
};

export type ComposeEmailInput = {
	template: Template;
	elements: TemplateElement[];
	components: DesignComponent[];
	assets: DesignAsset[];
	assetBaseUrl: string;
	/** Optional overrides merged on top of templates.content slots */
	extraSlots?: Record<string, string>;
};

function escapeHtmlAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Parse templates.content as scaffold JSON; tolerate legacy Tiptap docs. */
export function parseScaffoldContent(raw: string | null | undefined): ScaffoldContent {
	if (!raw?.trim()) return { slots: {} };
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return { slots: {} };
		}
		const obj = parsed as Record<string, unknown>;
		// Legacy Tiptap doc — ignore for slot purposes
		if (obj.type === 'doc') return { slots: {} };

		const slots: Record<string, string> = {};
		const slotSrc =
			obj.slots && typeof obj.slots === 'object' && !Array.isArray(obj.slots)
				? (obj.slots as Record<string, unknown>)
				: {};
		for (const [key, value] of Object.entries(slotSrc)) {
			if (typeof value === 'string') slots[key] = value;
		}
		// Flat keys at top level (except reserved) also count as slots
		for (const [key, value] of Object.entries(obj)) {
			if (key === 'subject' || key === 'preheader' || key === 'slots') continue;
			if (typeof value === 'string' && !(key in slots)) slots[key] = value;
		}

		return {
			subject: typeof obj.subject === 'string' ? obj.subject : undefined,
			preheader: typeof obj.preheader === 'string' ? obj.preheader : undefined,
			slots
		};
	} catch {
		return { slots: {} };
	}
}

export function serializeScaffoldContent(content: ScaffoldContent): string {
	return JSON.stringify({
		...(content.subject !== undefined ? { subject: content.subject } : {}),
		...(content.preheader !== undefined ? { preheader: content.preheader } : {}),
		slots: content.slots
	});
}

/**
 * Apply {{slot}} substitution and strip <!--owl-if:slot-->…<!--/owl-if--> when empty.
 * Nested if-blocks are processed from the inside out.
 */
export function applySlotTemplate(html: string, slots: Record<string, string>): string {
	let out = html;

	const innermostIf =
		/<!--owl-if:([a-zA-Z0-9_]+)-->((?:(?!<!--owl-if:)[\s\S])*?)<!--\/owl-if-->/g;
	let previous = '';
	while (out !== previous) {
		previous = out;
		out = out.replace(innermostIf, (_full, slot: string, body: string) => {
			const value = slots[slot]?.trim() ?? '';
			return value ? body : '';
		});
	}

	out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
		const value = slots[key] ?? '';
		return value;
	});

	return out;
}

function assetUrl(assetBaseUrl: string, assetId: string): string {
	return `${assetBaseUrl.replace(/\/$/, '')}/api/design-asset/${assetId}`;
}

function buildLogoSlots(
	assets: DesignAsset[],
	assetBaseUrl: string
): Record<string, string> {
	const logos = assets.filter((a) => a.kind === 'logo');
	const pair = pickEmailLogos(logos);
	if (!pair) return {};
	const light = assetUrl(assetBaseUrl, pair.light.id);
	const dark = assetUrl(assetBaseUrl, pair.dark.id);
	return {
		logo: light,
		logo_url: light,
		logo_light: light,
		logo_dark: dark,
		logo_dark_url: dark
	};
}

function elementConfigSlots(
	el: TemplateElement,
	assetBaseUrl: string
): Record<string, string> {
	const config = parseElementConfig(el.config);
	const slug = elementSlug(el.label, el.type);
	const slots: Record<string, string> = {};

	if (el.type === 'logo' || el.type === 'image') {
		if (config.assetId) {
			const url = assetUrl(assetBaseUrl, config.assetId);
			slots[slug] = url;
			slots[`${slug}_url`] = url;
			if (el.type === 'logo') {
				slots.logo = url;
				slots.logo_url = url;
			} else {
				slots.image = url;
				slots.image_url = url;
			}
		}
		return slots;
	}

	if (el.type === 'text') {
		if (config.text) {
			slots[slug] = config.text;
			slots[`${slug}_text`] = config.text;
			slots.body = config.text;
			slots.body_text = config.text;
		}
		return slots;
	}

	if (el.type === 'button' || el.type === 'cta' || el.type === 'link') {
		if (config.text) {
			slots[slug] = config.text;
			slots[`${slug}_label`] = config.text;
			slots[`${slug}_text`] = config.text;
			if (el.type === 'cta') {
				slots.cta_label = config.text;
				slots.primary_cta_label = config.text;
			}
			if (el.type === 'button') slots.button_label = config.text;
			if (el.type === 'link') slots.link_label = config.text;
		}
		if (config.url) {
			slots[`${slug}_url`] = config.url;
			slots[`${slug}_href`] = config.url;
			if (el.type === 'cta') {
				slots.cta_url = config.url;
				slots.primary_cta_url = config.url;
			}
			if (el.type === 'button') slots.button_url = config.url;
			if (el.type === 'link') slots.link_url = config.url;
		}
	}

	return slots;
}

function fixedSectionHtml(
	type: TemplateElementType,
	slots: Record<string, string>
): string {
	if (type === 'logo' || type === 'image') {
		const src = slots.logo_url || slots.image_url || slots[Object.keys(slots)[0]] || '';
		if (!src) return '';
		return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;" data-owl-section="${type}">
	<tbody>
		<tr>
			<td align="left" style="padding:12px 16px;">
				<img src="${escapeHtmlAttr(src)}" alt="" style="display:block;max-width:100%;height:auto;border:0;" />
			</td>
		</tr>
	</tbody>
</table>`;
	}

	if (type === 'text') {
		const text = slots.body || slots.body_text || Object.values(slots)[0] || '';
		if (!text) return '';
		return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;" data-owl-section="text">
	<tbody>
		<tr>
			<td style="padding:12px 16px;font-family:Arial,sans-serif;font-size:16px;line-height:26px;color:#0f172a;">
				<p style="margin:0;">${escapeHtmlText(text)}</p>
			</td>
		</tr>
	</tbody>
</table>`;
	}

	if (type === 'cta' || type === 'button' || type === 'link') {
		const label =
			slots.primary_cta_label ||
			slots.cta_label ||
			slots.button_label ||
			slots.link_label ||
			'';
		const url =
			slots.primary_cta_url || slots.cta_url || slots.button_url || slots.link_url || '#';
		if (!label) return '';
		if (type === 'link') {
			return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;" data-owl-section="link">
	<tbody>
		<tr>
			<td style="padding:12px 16px;font-family:Arial,sans-serif;font-size:14px;">
				<a href="${escapeHtmlAttr(url)}" style="color:#4f46e5;text-decoration:underline;" target="_blank" rel="noopener">${escapeHtmlText(label)}</a>
			</td>
		</tr>
	</tbody>
</table>`;
		}
		return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;" data-owl-section="${type}">
	<tbody>
		<tr>
			<td style="padding:12px 16px;">
				<a href="${escapeHtmlAttr(url)}" style="display:inline-block;padding:11px 18px;background-color:#000000;color:#faf9f7;text-decoration:none;border-radius:8px;font-family:Arial,sans-serif;font-size:14px;font-weight:400;" target="_blank" rel="noopener">${escapeHtmlText(label)}</a>
			</td>
		</tr>
	</tbody>
</table>`;
	}

	return '';
}

function wrapRoot(opts: {
	subject: string;
	preheader: string;
	sectionsHtml: string;
}): string {
	const subjectAttr = escapeHtmlAttr(opts.subject || 'Email');
	const preheaderText = escapeHtmlText(opts.preheader || opts.subject || '');
	const filler = Array.from({ length: 40 }, () => '&zwnj;&nbsp;').join('');

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${subjectAttr}</title>
</head>
<body style="margin:0;padding:0;background-color:#fefefe;">
<div
	role="article"
	aria-label="${subjectAttr}"
	lang="en"
	dir="auto"
	style="background-color:#fefefe;margin:0;padding:0;width:100%;"
>
	<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#fefefe;" aria-hidden="true">
		${preheaderText}
		${filler}
	</div>
	<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#fefefe;">
		<tbody>
			<tr>
				<td align="center" style="padding:0;">
					<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;margin-left:auto;margin-right:auto;background-color:#fefefe;" data-owl-column="main">
						<tbody>
							<tr>
								<td style="padding:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:max(16px,1rem);line-height:1.5;color:#000000;word-break:normal;word-wrap:normal;word-spacing:normal;" data-owl-sections>
${opts.sectionsHtml}
								</td>
							</tr>
						</tbody>
					</table>
				</td>
			</tr>
		</tbody>
	</table>
</div>
</body>
</html>`;
}

/**
 * Collect every slot name expected by the chosen elements (for AI scaffold validation).
 */
export function collectExpectedSlots(
	elements: TemplateElement[],
	components: DesignComponent[]
): string[] {
	const byId = new Map(components.map((c) => [c.id, c]));
	const names = new Set<string>();

	for (const el of elements) {
		if (el.type === 'component') {
			const config = parseElementConfig(el.config);
			const lib = config.designComponentId ? byId.get(config.designComponentId) : undefined;
			if (lib) {
				for (const p of parseComponentProps(lib)) names.add(p);
			}
			continue;
		}
		const slug = elementSlug(el.label, el.type);
		if (el.type === 'logo' || el.type === 'image') {
			names.add(slug);
			names.add(`${slug}_url`);
			if (el.type === 'logo') {
				names.add('logo');
				names.add('logo_url');
			} else {
				names.add('image');
				names.add('image_url');
			}
		} else if (el.type === 'text') {
			names.add(slug);
			names.add(`${slug}_text`);
			names.add('body');
		} else {
			names.add(slug);
			names.add(`${slug}_label`);
			names.add(`${slug}_url`);
			if (el.type === 'cta') {
				names.add('primary_cta_label');
				names.add('primary_cta_url');
				names.add('cta_label');
				names.add('cta_url');
			}
		}
	}

	return [...names].sort();
}

/**
 * Deterministic email HTML from ordered elements + design components + scaffold slots.
 */
export function composeEmailHtml(input: ComposeEmailInput): string {
	const scaffold = parseScaffoldContent(input.template.content);
	const logoSlots = buildLogoSlots(input.assets, input.assetBaseUrl);
	const slots: Record<string, string> = {
		...logoSlots,
		...scaffold.slots,
		...(input.extraSlots ?? {})
	};

	// Defaults for common empty slots
	if (!slots.unsubscribe_label) slots.unsubscribe_label = 'Unsubscribe';
	if (!slots.unsubscribe_url) slots.unsubscribe_url = '{{unsubscribe_url}}';
	if (!slots.header_url) slots.header_url = '#';

	const byId = new Map(input.components.map((c) => [c.id, c]));
	const sections: string[] = [];

	for (const el of input.elements) {
		const fromConfig = elementConfigSlots(el, input.assetBaseUrl);
		const merged = { ...slots, ...fromConfig };

		if (el.type === 'component') {
			const config = parseElementConfig(el.config);
			const lib = config.designComponentId ? byId.get(config.designComponentId) : undefined;
			if (!lib) continue;
			const html = applySlotTemplate(lib.html, merged).trim();
			if (html) sections.push(html);
			continue;
		}

		const html = fixedSectionHtml(el.type, merged).trim();
		if (html) sections.push(html);
	}

	const subject = scaffold.subject?.trim() || input.template.subject || 'Email';
	const preheader = scaffold.preheader?.trim() || subject;

	return wrapRoot({
		subject,
		preheader,
		sectionsHtml: sections.join('\n')
	});
}
