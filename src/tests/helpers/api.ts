type BuildApiEventOptions = {
	method?: string;
	path?: string;
	body?: unknown;
	headers?: Record<string, string>;
	params?: Record<string, string>;
	urlSearchParams?: Record<string, string>;
};

/**
 * Build a minimal SvelteKit-like RequestEvent for invoking `+server.ts` handlers directly.
 */
export function buildApiEvent(opts: BuildApiEventOptions = {}) {
	const method = opts.method ?? 'GET';
	const path = opts.path ?? '/api/v1/test';
	const headers = new Headers(opts.headers ?? {});

	let bodyInit: BodyInit | undefined;
	if (opts.body !== undefined) {
		if (!headers.has('content-type')) {
			headers.set('content-type', 'application/json');
		}
		bodyInit = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
	}

	const url = new URL(path, 'http://localhost:5173');
	if (opts.urlSearchParams) {
		for (const [k, v] of Object.entries(opts.urlSearchParams)) {
			url.searchParams.set(k, v);
		}
	}

	const request = new Request(url, { method, headers, body: bodyInit });

	return {
		request,
		url,
		params: opts.params ?? {},
		locals: {} as App.Locals,
		cookies: {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {},
			serialize: () => ''
		},
		fetch: globalThis.fetch,
		getClientAddress: () => '127.0.0.1',
		platform: undefined,
		route: { id: null },
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false
	};
}

export function bearer(apiKey: string) {
	return { authorization: `Bearer ${apiKey}` };
}

/** Invoke a handler and return { status, json } — catches HttpError from SvelteKit `error()`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function invokeHandler(
	// Accept any RequestHandler-shaped function; our mock event is intentionally partial.
	handler: (event: any) => Promise<Response> | Response,
	event: ReturnType<typeof buildApiEvent>
): Promise<{ status: number; json: unknown; response?: Response }> {
	try {
		const response = await handler(event);
		const json = await response.json().catch(() => null);
		return { status: response.status, json, response };
	} catch (err: unknown) {
		if (err instanceof Response) {
			const json = await err.json().catch(() => null);
			return { status: err.status, json, response: err };
		}
		const e = err as { status?: number; body?: unknown };
		if (typeof e?.status === 'number') {
			return { status: e.status, json: e.body ?? { message: String(err) } };
		}
		throw err;
	}
}
