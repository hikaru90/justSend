import juice from 'juice';
import { render } from 'svelte/server';
import { elementValueVariables } from '$lib/template-element-config';
import { env } from '../env';
import {
	compileTemplateComponents,
	extractPropNames,
	loadLinkedComponent,
	TemplateCompileError
} from './template-compile-service';
import { listElements } from './template-element-service';
import { hasTemplateComponents } from './template-component-service';
import { getTemplate } from './template-service';

export type RenderTemplateOptions = {
	templateId: string;
	teamId: number;
	domainId?: number;
	assetBaseUrl?: string;
	/** Extra variable overrides (e.g. logo_light / logo_dark) */
	extraProps?: Record<string, string>;
};

const PROP_PLACEHOLDERS: Record<string, string> = {
	cta_label: 'Click here',
	cta_url: 'https://example.com',
	button_label: 'Get started',
	button_url: 'https://example.com',
	link_label: 'Learn more',
	link_url: 'https://example.com',
	headline: 'Welcome aboard',
	title: 'Hello there',
	logo: 'https://placehold.co/120x40/png?text=Logo',
	logo_url: 'https://placehold.co/120x40/png?text=Logo',
	logo_light: 'https://placehold.co/120x40/png?text=Logo',
	logo_dark: 'https://placehold.co/120x40/png?text=Logo',
	logo_dark_url: 'https://placehold.co/120x40/png?text=Logo',
	image: 'https://placehold.co/600x300/png?text=Image',
	image_url: 'https://placehold.co/600x300/png?text=Image'
};

function placeholderForProp(name: string): string {
	if (PROP_PLACEHOLDERS[name]) return PROP_PLACEHOLDERS[name];
	const lower = name.toLowerCase();
	if (lower.includes('url') || lower.includes('href') || lower.includes('link')) {
		return 'https://example.com';
	}
	if (lower.includes('logo')) return PROP_PLACEHOLDERS.logo_url;
	if (lower.includes('image') || lower.includes('img')) return PROP_PLACEHOLDERS.image_url;
	return '';
}

/**
 * SSR-render a component-backed template to a single email-ready HTML string
 * with CSS inlined via juice.
 */
export async function renderTemplateHtml(opts: RenderTemplateOptions): Promise<string> {
	getTemplate(opts.templateId, opts.teamId, opts.domainId);

	if (!hasTemplateComponents(opts.templateId)) {
		throw new TemplateCompileError('Template has no Svelte components — regenerate it');
	}

	const assetBaseUrl = (opts.assetBaseUrl ?? env.HOST_URL).replace(/\/$/, '');
	const elements = listElements(opts.templateId, opts.teamId, opts.domainId);

	const props: Record<string, string> = { ...(opts.extraProps ?? {}) };
	for (const el of elements) {
		Object.assign(props, elementValueVariables(el, { assetBaseUrl }));
	}

	const { linked, components } = await compileTemplateComponents(opts.templateId, 'server');

	// Ensure every declared $props() binding has a value so SSR never sees bare undefined
	// for required-looking aliases the model forgot to wire to an element.
	for (const c of components) {
		for (const name of extractPropNames(c.source)) {
			if (props[name] === undefined) {
				props[name] = placeholderForProp(name);
			}
		}
	}

	const Root = await loadLinkedComponent(linked);
	const result = render(Root, { props });

	const head = result.head?.trim() ?? '';
	const body = result.body?.trim() ?? '';

	const document = [
		'<!DOCTYPE html>',
		'<html>',
		'<head>',
		'<meta charset="utf-8" />',
		'<meta name="viewport" content="width=device-width, initial-scale=1" />',
		head,
		'</head>',
		'<body>',
		body,
		'</body>',
		'</html>'
	].join('');

	return juice(document, {
		removeStyleTags: true,
		preserveMediaQueries: true,
		applyWidthAttributes: true,
		applyHeightAttributes: true
	});
}

/**
 * Build props for preview/send without rendering.
 */
export function buildTemplateElementProps(
	templateId: string,
	teamId: number,
	domainId: number | undefined,
	assetBaseUrl: string,
	extraProps?: Record<string, string>
): Record<string, string> {
	const props: Record<string, string> = { ...(extraProps ?? {}) };
	for (const el of listElements(templateId, teamId, domainId)) {
		Object.assign(props, elementValueVariables(el, { assetBaseUrl }));
	}
	return props;
}
