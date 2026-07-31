export type TemplateElementType =
	| 'logo'
	| 'text'
	| 'button'
	| 'cta'
	| 'link'
	| 'image'
	| 'component';

export type TemplateElementConfig = {
	/** Display / button / link text */
	text?: string;
	/** Destination URL for button, CTA, or link */
	url?: string;
	/** Design-asset id for logo or image */
	assetId?: string;
	/** Design-system component id when type is component */
	designComponentId?: string;
};

export function parseElementConfig(raw: string | null | undefined): TemplateElementConfig {
	if (!raw?.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const obj = parsed as Record<string, unknown>;
		const config: TemplateElementConfig = {};
		if (typeof obj.text === 'string' && obj.text.trim()) config.text = obj.text.trim();
		if (typeof obj.url === 'string' && obj.url.trim()) config.url = obj.url.trim();
		if (typeof obj.assetId === 'string' && obj.assetId.trim()) config.assetId = obj.assetId.trim();
		if (typeof obj.designComponentId === 'string' && obj.designComponentId.trim()) {
			config.designComponentId = obj.designComponentId.trim();
		}
		return config;
	} catch {
		return {};
	}
}

export function serializeElementConfig(config: TemplateElementConfig): string {
	const cleaned: TemplateElementConfig = {};
	if (config.text?.trim()) cleaned.text = config.text.trim();
	if (config.url?.trim()) cleaned.url = config.url.trim();
	if (config.assetId?.trim()) cleaned.assetId = config.assetId.trim();
	if (config.designComponentId?.trim()) cleaned.designComponentId = config.designComponentId.trim();
	return JSON.stringify(cleaned);
}

export function elementSlug(label: string, type: TemplateElementType): string {
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_|_$/g, '');
	return slug || type;
}

/**
 * Build send/preview variable map for one element.
 * Image-like types expose the absolute asset URL; text/link types expose text + url.
 * Library component elements do not contribute prop values.
 */
export function elementValueVariables(
	el: { type: TemplateElementType; label: string; config: string },
	opts: { assetBaseUrl?: string; assetUrlById?: Record<string, string> } = {}
): Record<string, string> {
	if (el.type === 'component') return {};

	const config = parseElementConfig(el.config);
	const slug = elementSlug(el.label, el.type);
	const vars: Record<string, string> = {};

	if (el.type === 'logo' || el.type === 'image') {
		const url =
			(config.assetId && opts.assetUrlById?.[config.assetId]) ||
			(config.assetId && opts.assetBaseUrl
				? `${opts.assetBaseUrl.replace(/\/$/, '')}/api/design-asset/${config.assetId}`
				: undefined);
		if (url) {
			vars[slug] = url;
			vars[`${slug}_url`] = url;
			if (el.type === 'logo') {
				vars.logo = url;
				vars.logo_url = url;
			} else {
				vars.image = url;
				vars.image_url = url;
			}
		}
		return vars;
	}

	if (el.type === 'text') {
		if (config.text) {
			vars[slug] = config.text;
			vars[`${slug}_text`] = config.text;
		}
		return vars;
	}

	// button | cta | link
	if (config.text) {
		vars[slug] = config.text;
		vars[`${slug}_label`] = config.text;
		vars[`${slug}_text`] = config.text;
		if (el.type === 'cta') vars.cta_label = config.text;
		if (el.type === 'button') vars.button_label = config.text;
		if (el.type === 'link') vars.link_label = config.text;
	}
	if (config.url) {
		vars[`${slug}_url`] = config.url;
		vars[`${slug}_href`] = config.url;
		if (el.type === 'cta') vars.cta_url = config.url;
		if (el.type === 'button') vars.button_url = config.url;
		if (el.type === 'link') vars.link_url = config.url;
	}
	return vars;
}

/** Human-readable config line for the AI prompt. */
export function formatElementConfigForPrompt(
	el: { type: TemplateElementType; label: string; config: string },
	opts: {
		assetBaseUrl?: string;
		assetUrlById?: Record<string, string>;
		/** Optional lookup for library component elements */
		designComponentById?: Record<
			string,
			{ name: string; starterKey?: string | null; kind?: string }
		>;
	} = {}
): string {
	const config = parseElementConfig(el.config);
	const parts: string[] = [];

	if (el.type === 'component') {
		const lib = config.designComponentId
			? opts.designComponentById?.[config.designComponentId]
			: undefined;
		if (lib) {
			parts.push(`library component "${lib.name}"`);
			if (lib.starterKey) parts.push(`libraryRef=${lib.starterKey}`);
			else parts.push(`libraryRef=${lib.name}`);
			if (lib.kind) parts.push(`kind=${lib.kind}`);
		} else if (config.designComponentId) {
			parts.push(`designComponentId=${config.designComponentId}`);
		} else {
			parts.push('(no design-system component selected)');
		}
		parts.push('MUST include this library section with locked=true');
		return parts.join('; ');
	}

	if (el.type === 'logo' || el.type === 'image') {
		if (config.assetId) {
			const url =
				opts.assetUrlById?.[config.assetId] ||
				(opts.assetBaseUrl
					? `${opts.assetBaseUrl.replace(/\/$/, '')}/api/design-asset/${config.assetId}`
					: undefined);
			if (url) parts.push(`src="${url}"`);
			else parts.push(`assetId=${config.assetId}`);
		} else {
			parts.push('(no image selected — pick a design-system asset URL)');
		}
	} else if (el.type === 'text') {
		parts.push(config.text ? `text="${config.text}"` : '(no text yet)');
	} else {
		parts.push(config.text ? `text="${config.text}"` : '(no label text yet)');
		parts.push(config.url ? `url="${config.url}"` : '(no url yet)');
	}

	return parts.join('; ');
}
