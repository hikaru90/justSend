import { env } from '../env';
import { upsertComponent, upsertDesignMd, type DesignSystem } from './design-system-service';

const MAX_PAGE_CHARS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

function assertSafeUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid URL');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('URL must be http or https');
	}

	const host = url.hostname.toLowerCase();
	if (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '::1' ||
		host === '0.0.0.0' ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		host === 'metadata.google.internal'
	) {
		throw new Error('URL host is not allowed');
	}

	// Block obvious private / link-local IPv4 ranges (hostname as IP).
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
		if (
			a === 10 ||
			a === 127 ||
			a === 0 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		) {
			throw new Error('URL host is not allowed');
		}
	}

	return url;
}

function stripHtmlNoise(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function fetchPageText(url: URL): Promise<string> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url.toString(), {
			signal: controller.signal,
			redirect: 'follow',
			headers: {
				'User-Agent': 'OwleryDesignInfer/1.0',
				Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
			}
		});
		if (!response.ok) {
			throw new Error(`Failed to fetch URL (${response.status})`);
		}
		const contentType = response.headers.get('content-type') ?? '';
		if (
			contentType &&
			!contentType.includes('text/html') &&
			!contentType.includes('application/xhtml') &&
			!contentType.includes('text/plain')
		) {
			throw new Error('URL did not return HTML');
		}
		const raw = await response.text();
		const cleaned = stripHtmlNoise(raw);
		if (!cleaned) {
			throw new Error('Page content was empty after cleanup');
		}
		return cleaned.slice(0, MAX_PAGE_CHARS);
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw new Error('Timed out fetching URL');
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

function stripMarkdownFences(text: string): string {
	const trimmed = text.trim();
	const fenced = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
	return fenced ? fenced[1].trim() : trimmed;
}

type InferPayload = {
	designMd: string;
	components?: Array<{ name: string; description?: string; html: string }>;
};

function parseInferPayload(raw: string): InferPayload {
	const text = stripMarkdownFences(raw);
	try {
		const parsed = JSON.parse(text) as InferPayload;
		if (!parsed.designMd || typeof parsed.designMd !== 'string') {
			throw new Error('missing designMd');
		}
		return parsed;
	} catch {
		// Model sometimes returns bare markdown — treat whole response as design.md
		if (text.includes('#') || text.length > 40) {
			return { designMd: text, components: [] };
		}
		throw new Error('AI returned an unreadable design system payload');
	}
}

async function chatCompletion(messages: Array<{ role: 'system' | 'user'; content: string }>) {
	if (!env.OPENROUTER_API_KEY) {
		throw new Error('OPENROUTER_API_KEY is not configured');
	}

	const response = await fetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': env.HOST_URL,
			'X-Title': 'Owlery'
		},
		body: JSON.stringify({
			model: env.OPENROUTER_MODEL,
			messages
		})
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 500)}`);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const content = data.choices?.[0]?.message?.content;
	if (!content?.trim()) {
		throw new Error('OpenRouter returned empty content');
	}
	return content;
}

export async function inferDesignSystemFromUrl(
	teamId: number,
	rawUrl: string
): Promise<{ system: DesignSystem; componentsCreated: number }> {
	const url = assertSafeUrl(rawUrl.trim());
	const pageText = await fetchPageText(url);

	const systemPrompt = [
		'You extract a brand design system suitable for email templates from a website page.',
		'Return ONLY valid JSON (no markdown fences) with this shape:',
		'{ "designMd": string, "components": [ { "name": string, "description": string, "html": string } ] }',
		'designMd must be a markdown document covering: brand voice, colors (hex), typography, spacing, buttons, links, logo usage, and email-friendly layout notes.',
		'components should be 2–6 reusable email HTML snippets (inline CSS, table-friendly) inspired by the site (e.g. Primary Button, Footer, Header).',
		'Use {{variable}} placeholders where dynamic text belongs.'
	].join(' ');

	const userPrompt = [
		`Source URL: ${url.toString()}`,
		'',
		'Page content (scripts/styles removed, truncated):',
		pageText
	].join('\n');

	const raw = await chatCompletion([
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userPrompt }
	]);

	const payload = parseInferPayload(raw);
	const system = upsertDesignMd(teamId, payload.designMd.trim());

	let componentsCreated = 0;
	for (const component of payload.components ?? []) {
		const name = component.name?.trim();
		const html = component.html?.trim();
		if (!name || !html) continue;
		upsertComponent(teamId, {
			name,
			description: component.description?.trim() || null,
			html
		});
		componentsCreated += 1;
	}

	return { system, componentsCreated };
}
