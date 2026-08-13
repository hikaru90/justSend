import { parse as devalueParse } from 'devalue';
import type { ActionResult } from '@sveltejs/kit';

/**
 * Parse a SvelteKit form-action JSON response without `$app/forms` `deserialize`.
 * That helper reads `app.decoders`, which can be undefined under Vite HMR and
 * breaks studio compile with "Cannot read properties of undefined (reading 'decoders')".
 * Owl action payloads are plain JSON-compatible values, so default devalue is enough.
 */
export function parseActionResult<
	Success extends Record<string, unknown> | undefined = Record<string, unknown>,
	Failure extends Record<string, unknown> | undefined = Record<string, unknown>,
>(text: string): ActionResult<Success, Failure> {
	const parsed = JSON.parse(text) as ActionResult<Success, Failure> & { data?: unknown };
	if ((parsed.type === 'success' || parsed.type === 'failure') && typeof parsed.data === 'string') {
		return {
			...parsed,
			data: devalueParse(parsed.data) as Success & Failure,
		};
	}
	return parsed;
}
