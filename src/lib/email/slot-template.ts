/**
 * Apply {{slot}} substitution and strip <!--owl-if:slot-->…<!--/owl-if--> when empty.
 * Nested if-blocks are processed from the inside out.
 * Safe for client and server.
 * Kept for the legacy single-HTML compose path.
 */
export function applySlotTemplate(html: string, slots: Record<string, string>): string {
	let out = html;

	const innermostIf = /<!--owl-if:([a-zA-Z0-9_]+)-->((?:(?!<!--owl-if:)[\s\S])*?)<!--\/owl-if-->/g;
	let previous = '';
	while (out !== previous) {
		previous = out;
		out = out.replace(innermostIf, (_full, slot: string, body: string) => {
			const value = slots[slot]?.trim() ?? '';
			return value ? body : '';
		});
	}

	out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
		const value = slots[key] ?? '';
		return value;
	});

	return out;
}
