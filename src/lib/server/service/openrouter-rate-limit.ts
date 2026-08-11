/**
 * Global OpenRouter request gate.
 *
 * - At most one OpenRouter HTTP request in flight
 * - At least 1 second between request starts
 * - On 429 / rate-limit: wait a few seconds, then retry (up to 3 times)
 *
 * Used by `openRouterChat` and by a `globalThis.fetch` wrapper so Pi SDK
 * tool-loop calls are throttled the same way.
 */

const MIN_INTERVAL_MS = 1_000;
const FAIL_WAIT_MS = 5_000;
const FAIL_RETRIES = 3;

let queue: Promise<void> = Promise.resolve();
let lastStartAt = 0;
let cooldownUntil = 0;
let fetchInstalled = false;
let originalFetch: typeof globalThis.fetch | null = null;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			const err = new Error('Aborted');
			err.name = 'AbortError';
			reject(err);
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			const err = new Error('Aborted');
			err.name = 'AbortError';
			reject(err);
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}

export function isOpenRouterUrl(url: string): boolean {
	try {
		const host = new URL(url).hostname.toLowerCase();
		return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
	} catch {
		return /openrouter\.ai/i.test(url);
	}
}

function requestUrl(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.href;
	return input.url;
}

/**
 * Hold the rate-limit slot until the response body finishes (or there is no body).
 * Prevents overlapping OpenRouter streams from Pi tool loops.
 */
function holdSlotUntilBodyDone(response: Response, release: () => void): Response {
	if (!response.body) {
		release();
		return response;
	}

	let released = false;
	const done = () => {
		if (released) return;
		released = true;
		release();
	};

	const reader = response.body.getReader();
	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { done: finished, value } = await reader.read();
				if (finished) {
					controller.close();
					done();
					return;
				}
				controller.enqueue(value);
			} catch (err) {
				done();
				controller.error(err);
			}
		},
		cancel(reason) {
			void reader.cancel(reason).catch(() => undefined);
			done();
		},
	});

	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

/**
 * Run `fn` under the OpenRouter gate (serialize + ≥1s spacing).
 * Prefer {@link openRouterFetch} for HTTP; use this for non-fetch work that
 * still counts as an OpenRouter "turn".
 */
export async function withOpenRouterRateLimit<T>(
	fn: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	let release!: () => void;
	const slotDone = new Promise<void>((r) => {
		release = r;
	});

	const prev = queue;
	queue = prev.then(() => slotDone);

	await prev;
	try {
		if (signal?.aborted) {
			const err = new Error('Aborted');
			err.name = 'AbortError';
			throw err;
		}
		const waitMs = Math.max(
			0,
			lastStartAt + MIN_INTERVAL_MS - Date.now(),
			cooldownUntil - Date.now(),
		);
		if (waitMs > 0) await sleep(waitMs, signal);
		lastStartAt = Date.now();
		return await fn();
	} finally {
		release();
	}
}

async function fetchWithRetries(
	baseFetch: typeof globalThis.fetch,
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	signal?: AbortSignal,
): Promise<Response> {
	for (let attempt = 1; ; attempt++) {
		if (signal?.aborted) {
			const err = new Error('Aborted');
			err.name = 'AbortError';
			throw err;
		}

		const waitMs = Math.max(
			0,
			lastStartAt + MIN_INTERVAL_MS - Date.now(),
			cooldownUntil - Date.now(),
		);
		if (waitMs > 0) await sleep(waitMs, signal);
		lastStartAt = Date.now();

		const response = await baseFetch(input, init);

		if (response.status !== 429 || attempt > FAIL_RETRIES) {
			return response;
		}

		// Drain/cancel the error body before waiting to retry.
		await response.body?.cancel().catch(() => undefined);
		cooldownUntil = Date.now() + FAIL_WAIT_MS;
		await sleep(FAIL_WAIT_MS, signal);
	}
}

/**
 * Rate-limited fetch for OpenRouter. Non-OpenRouter URLs pass through.
 * Serializes in-flight OpenRouter calls and spaces starts ≥1s apart.
 */
export async function openRouterFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const url = requestUrl(input);
	const baseFetch = originalFetch ?? globalThis.fetch.bind(globalThis);

	if (!isOpenRouterUrl(url)) {
		return baseFetch(input, init);
	}

	const signal = init?.signal ?? undefined;
	let release!: () => void;
	const slotDone = new Promise<void>((r) => {
		release = r;
	});
	const prev = queue;
	queue = prev.then(() => slotDone);
	await prev;

	try {
		const response = await fetchWithRetries(baseFetch, input, init, signal ?? undefined);
		// Keep the slot until the stream finishes so tool loops can't overlap.
		return holdSlotUntilBodyDone(response, release);
	} catch (err) {
		release();
		throw err;
	}
}

/** Patch `globalThis.fetch` so Pi SDK OpenRouter calls share the same gate. */
export function installOpenRouterFetchThrottle(): void {
	if (fetchInstalled) return;
	fetchInstalled = true;
	originalFetch = globalThis.fetch.bind(globalThis);
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
		openRouterFetch(input, init)) as typeof globalThis.fetch;
}

/** Test helper — reset queue / cooldown / fetch patch. */
export function resetOpenRouterRateLimitForTests(): void {
	queue = Promise.resolve();
	lastStartAt = 0;
	cooldownUntil = 0;
	if (fetchInstalled && originalFetch) {
		globalThis.fetch = originalFetch;
	}
	fetchInstalled = false;
	originalFetch = null;
}
