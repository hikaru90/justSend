/**
 * Starter Owl HTML components shipped with the app. Loaded via Vite raw
 * imports; referenced by design-system seeding and the AI compose flows.
 * Do not import from tsx scripts (worker) — `?raw` is a Vite feature.
 */

export type StarterComponent = {
	key: string;
	name: string;
	role: 'shell' | 'section';
	description: string;
	html: string;
};

const LABELS: Record<string, { name: string; role: 'shell' | 'section'; description: string }> = {
	'base-layout': {
		name: 'Base layout',
		role: 'shell',
		description: 'Full document shell: backdrop, 620px canvas, preheader, dark-mode support.',
	},
	'logo-header': {
		name: 'Logo header',
		role: 'section',
		description: 'Brand logo with light/dark variants.',
	},
	heading: {
		name: 'Heading',
		role: 'section',
		description: 'Section heading (h2).',
	},
	text: {
		name: 'Text',
		role: 'section',
		description: 'Body paragraph.',
	},
	'hero-image': {
		name: 'Hero image',
		role: 'section',
		description: 'Full-width featured image.',
	},
	'cta-button': {
		name: 'Call to action',
		role: 'section',
		description: 'Single-button primary CTA.',
	},
	divider: {
		name: 'Divider',
		role: 'section',
		description: 'Hairline separator.',
	},
	spacer: {
		name: 'Spacer',
		role: 'section',
		description: 'Vertical breathing room.',
	},
	'two-column': {
		name: 'Two columns',
		role: 'section',
		description: 'Two stackable columns on mobile.',
	},
	'footer-legal': {
		name: 'Footer',
		role: 'section',
		description: 'Hairline footer with unsubscribe link.',
	},
};

const modules = import.meta.glob('./starters/*.owl.html', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

function keyOf(path: string): string {
	return path.replace(/^.*\/starters\//, '').replace(/\.owl\.html$/, '');
}

export const STARTERS: StarterComponent[] = Object.keys(modules)
	.map((path) => {
		const key = keyOf(path);
		const meta = LABELS[key] ?? {
			name: key.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
			role: 'section' as const,
			description: '',
		};
		return { key, name: meta.name, role: meta.role, description: meta.description, html: modules[path]! };
	})
	.sort((a, b) => (a.role === 'shell' ? -1 : b.role === 'shell' ? 1 : a.name.localeCompare(b.name)));

export function starterByKey(key: string): StarterComponent | undefined {
	return STARTERS.find((s) => s.key === key);
}
