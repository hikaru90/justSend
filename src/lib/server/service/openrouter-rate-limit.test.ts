import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	installOpenRouterFetchThrottle,
	isOpenRouterUrl,
	openRouterFetch,
	resetOpenRouterRateLimitForTests,
} from './openrouter-rate-limit';

describe('openrouter-rate-limit', () => {
	afterEach(() => {
		resetOpenRouterRateLimitForTests();
		vi.useRealTimers();
	});

	it('detects OpenRouter URLs', () => {
		expect(isOpenRouterUrl('https://openrouter.ai/api/v1/chat/completions')).toBe(true);
		expect(isOpenRouterUrl('https://api.openrouter.ai/api/v1/chat/completions')).toBe(true);
		expect(isOpenRouterUrl('https://example.com/chat')).toBe(false);
	});

	it('spaces OpenRouter requests at least 1 second apart', async () => {
		vi.useFakeTimers();
		const calls: number[] = [];
		const started = Date.now();

		const baseFetch = vi.fn(async () => {
			calls.push(Date.now() - started);
			return new Response('ok', { status: 200 });
		});

		// Install with our mock underneath
		resetOpenRouterRateLimitForTests();
		(globalThis as { fetch: typeof fetch }).fetch = baseFetch as unknown as typeof fetch;
		installOpenRouterFetchThrottle();

		const p1 = openRouterFetch('https://openrouter.ai/api/v1/chat/completions');
		const p2 = openRouterFetch('https://openrouter.ai/api/v1/chat/completions');

		// First starts immediately; drain its body so the slot releases.
		await vi.advanceTimersByTimeAsync(0);
		const r1 = await p1;
		await r1.text();

		await vi.advanceTimersByTimeAsync(999);
		// Still waiting for the 1s gap
		expect(calls).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);
		const r2 = await p2;
		await r2.text();

		expect(calls).toHaveLength(2);
		expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(1000);
	});

	it('waits a few seconds and retries on 429', async () => {
		vi.useFakeTimers();
		let n = 0;
		const baseFetch = vi.fn(async () => {
			n += 1;
			if (n < 3) return new Response('rate limited', { status: 429 });
			return new Response('ok', { status: 200 });
		});

		resetOpenRouterRateLimitForTests();
		(globalThis as { fetch: typeof fetch }).fetch = baseFetch as unknown as typeof fetch;
		installOpenRouterFetchThrottle();

		const pending = openRouterFetch('https://openrouter.ai/api/v1/chat/completions');
		await vi.advanceTimersByTimeAsync(0);
		// First 429 → wait 5s
		await vi.advanceTimersByTimeAsync(5_000);
		// Second 429 → wait 5s
		await vi.advanceTimersByTimeAsync(5_000);
		const res = await pending;
		expect(res.status).toBe(200);
		await res.text();
		expect(baseFetch).toHaveBeenCalledTimes(3);
	});

	it('does not throttle non-OpenRouter URLs', async () => {
		const baseFetch = vi.fn(async () => new Response('ok', { status: 200 }));
		resetOpenRouterRateLimitForTests();
		(globalThis as { fetch: typeof fetch }).fetch = baseFetch as unknown as typeof fetch;
		installOpenRouterFetchThrottle();

		const a = openRouterFetch('https://example.com/a');
		const b = openRouterFetch('https://example.com/b');
		await Promise.all([a, b]);
		expect(baseFetch).toHaveBeenCalledTimes(2);
	});
});
