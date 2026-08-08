import type { MjmlError, MjmlResult } from 'mjml';

export type { MjmlError, MjmlResult };

/**
 * Server-only MJML compile stage. `mjml` is a CJS package loaded lazily so the
 * client bundle never pulls it in; it stays external in the SSR bundle.
 */
export async function transpileMjml(xml: string): Promise<MjmlResult> {
	const { default: mjml2html } = await import('mjml');
	return mjml2html(xml, {
		validationLevel: 'skip',
		minify: false,
		keepComments: true,
	});
}
