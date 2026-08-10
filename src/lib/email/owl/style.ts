/**
 * Deterministic inline-style helpers. Work on the serialized `style`
 * attribute string and preserve declaration order.
 */

export type Decl = [property: string, value: string];

export function parseStyleDecls(style: string | null | undefined): Decl[] {
	if (!style) return [];
	const out: Decl[] = [];
	for (const chunk of style.split(';')) {
		const idx = chunk.indexOf(':');
		if (idx === -1) continue;
		const prop = chunk.slice(0, idx).trim().toLowerCase();
		const value = chunk.slice(idx + 1).trim();
		if (!prop || !value) continue;
		out.push([prop, value]);
	}
	return out;
}

/** Merge `extra` into an existing style string. `override` decides conflicts. */
export function mergeStyleDecls(
	style: string | null | undefined,
	extra: Decl[],
	override = true,
): string {
	const map = new Map<string, string>();
	const order: string[] = [];
	for (const [p, v] of parseStyleDecls(style)) {
		if (!map.has(p)) order.push(p);
		map.set(p, v);
	}
	for (const [p, v] of extra) {
		if (override || !map.has(p)) {
			if (!map.has(p)) order.push(p);
			map.set(p, v);
		}
	}
	return order.map((p) => `${p}:${map.get(p)};`).join('');
}

export function removeStyleDecls(style: string | null | undefined, props: string[]): string {
	const banned = new Set(props.map((p) => p.toLowerCase()));
	return parseStyleDecls(style)
		.filter(([p]) => !banned.has(p))
		.map(([p, v]) => `${p}:${v};`)
		.join('');
}

/** Two-stop `linear-gradient(...)` detector used for compiler color pins. */
const GRADIENT_PIN_RE = /linear-gradient\(\s*([^,)]+?)\s*,\s*([^,)]+?)\s*\)/i;

/** Normalize a color literal for comparisons (#fff -> #ffffff, lowercase). */
export function normalizeHexColor(value: string | null | undefined): string {
	const v = (value ?? '').trim().toLowerCase();
	const m = /^#([0-9a-f]{3})$/.exec(v);
	if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
	return v;
}

/**
 * Two-stop `linear-gradient(C, C)` pin color, when both stops are the same.
 * Such a gradient paints a solid color — it only exists as a dark-mode
 * hardening pin; authored decorative gradients have distinct stops.
 */
export function gradientPinColor(value: string | null | undefined): string | null {
	const match = value ? GRADIENT_PIN_RE.exec(value) : null;
	if (!match) return null;
	return normalizeHexColor(match[1]) === normalizeHexColor(match[2])
		? normalizeHexColor(match[1])
		: null;
}

/** Add a class to an element, preserving class order and de-duplicating. */
export function addClass(el: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void }, cls: string): void {
	const current = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
	if (current.includes(cls)) return;
	current.push(cls);
	el.setAttribute('class', current.join(' '));
}

/** Remove all classes with the given prefix from an element. */
export function removeClassesByPrefix(el: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void }, prefix: string): void {
	const current = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
	const next = current.filter((c) => !c.startsWith(prefix));
	if (next.length !== current.length) {
		el.setAttribute('class', next.join(' '));
	}
}
