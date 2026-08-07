import { env } from '../env';
import { installOpenRouterFetchThrottle, openRouterFetch } from './openrouter-rate-limit';
import { resolveOpenRouterApiKey } from './team-openrouter-key-service';

export type OpenRouterMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type OpenRouterChatOpts = {
	signal?: AbortSignal;
	/** When set, use the team's BYOK key if present, otherwise platform credits. */
	teamId?: number;
	/** Override resolved API key (mainly for tests). */
	apiKey?: string;
	/** Default true. When false, waits for full JSON response. */
	stream?: boolean;
	/** Force JSON object response (non-stream or stream depending on provider support). */
	jsonObject?: boolean;
	/** Called with each text delta and running total character count. */
	onDelta?: (delta: string, chars: number) => void;
};

async function readOpenRouterStream(
	response: Response,
	opts: {
		signal?: AbortSignal;
		onDelta?: (delta: string, chars: number) => void;
	},
): Promise<string> {
	if (!response.body) {
		throw new Error('OpenRouter returned an empty stream body');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let content = '';

	try {
		while (true) {
			if (opts.signal?.aborted) {
				throw new DOMException('Generation cancelled', 'AbortError');
			}
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith(':')) continue;
				if (!trimmed.startsWith('data:')) continue;
				const data = trimmed.slice(5).trim();
				if (data === '[DONE]') continue;
				try {
					const parsed = JSON.parse(data) as {
						choices?: Array<{ delta?: { content?: string } }>;
					};
					const delta = parsed.choices?.[0]?.delta?.content;
					if (delta) {
						content += delta;
						opts.onDelta?.(delta, content.length);
					}
				} catch {
					// ignore malformed SSE chunks
				}
			}
		}
	} finally {
		reader.releaseLock();
	}

	return content;
}

/** Chat completion via OpenRouter, optionally streaming deltas. */
export async function openRouterChat(
	messages: OpenRouterMessage[],
	opts: OpenRouterChatOpts = {},
): Promise<string> {
	const apiKey = opts.apiKey?.trim() || resolveOpenRouterApiKey(opts.teamId);
	if (!apiKey) {
		throw new Error('OpenRouter is not configured (set OPENROUTER_API_KEY or add a team key)');
	}

	const stream = opts.stream !== false;
	const body: Record<string, unknown> = {
		model: env.OPENROUTER_MODEL,
		messages,
		stream,
	};
	if (opts.jsonObject) {
		body.response_format = { type: 'json_object' };
	}

	installOpenRouterFetchThrottle();

	const response = await openRouterFetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': env.HOST_URL,
			'X-Title': 'Owlery',
		},
		body: JSON.stringify(body),
		signal: opts.signal,
	});

	if (!response.ok) {
		const errBody = await response.text().catch(() => '');
		throw new Error(`OpenRouter request failed (${response.status}): ${errBody.slice(0, 500)}`);
	}

	if (!stream) {
		const json = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = json.choices?.[0]?.message?.content ?? '';
		if (content) opts.onDelta?.(content, content.length);
		return content;
	}

	return readOpenRouterStream(response, {
		signal: opts.signal,
		onDelta: opts.onDelta,
	});
}

export function openRouterModel(): string {
	return env.OPENROUTER_MODEL;
}
