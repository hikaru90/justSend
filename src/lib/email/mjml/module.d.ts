declare module 'mjml' {
	export type MjmlOptions = {
		validationLevel?: 'strict' | 'soft' | 'skip';
		minify?: boolean;
		keepComments?: boolean;
		fonts?: Record<string, string>;
		lang?: string;
	};

	export type MjmlError = {
		line?: number;
		message: string;
		tagName?: string;
	};

	export type MjmlResult = {
		html: string;
		json: unknown;
		errors: MjmlError[];
	};

	// MJML 5: default export is async.
	export default function mjml2html(input: string, options?: MjmlOptions): Promise<MjmlResult>;
}
