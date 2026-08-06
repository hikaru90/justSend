/**
 * Owl HTML v1 — format constants and shared types.
 *
 * An Owl document is annotated, table-based email HTML. The annotations are
 * inert `data-owl-*` attributes that drive the editor, AI, and the compiler.
 * The compiler is a pure function: same input bytes -> same output bytes.
 */

export const OWL = {
	/** Stable element id used for selection / CSS-class derivation. */
	id: 'data-owl-id',
	/** Component marker on the root element of a section. */
	component: 'data-owl-component',
	/** shell | section */
	role: 'data-owl-role',
	/** Declared content target: data-owl-slot="name". */
	slot: 'data-owl-slot',
	/** Slot value type: text|url|image|color|boolean. */
	slotType: 'data-owl-slot-type',
	/** Human label for the slot (drives the Content panel / AI prompts). */
	slotLabel: 'data-owl-slot-label',
	/** Per-element dark-mode inline style. */
	darkStyle: 'data-owl-dark-style',
	/** Design-token reference, resolved to literals at compile time. */
	token: 'data-owl-token',
	/** Dark-variant token reference, resolved before dark emission. */
	darkToken: 'data-owl-dark-token',
	/** Content-variant marker: light | dark (pair elements that swap via CSS). */
	variant: 'data-owl-variant',
	/** Shared id linking a light/dark content pair. */
	variantGroup: 'data-owl-variant-group',
	/** Marks the element whose text content is the preheader. */
	preheader: 'data-owl-preheader',
	/** Marks a region gated by a boolean slot (hidden when slot is false). */
	boolean: 'data-owl-boolean',
	/** Marks the compiled dark-CSS container in <head>. */
	darkCss: 'data-owl-dark-css',
	/** Marks the compiled base-CSS container in <head>. */
	baseCss: 'data-owl-base-css',
	/** Comment anchor where sections are spliced in (without braces). */
	sectionsAnchor: 'owl:sections',
	/** Comment anchor for the preheader (fallback when no element present). */
	preheaderAnchor: 'owl:preheader',
} as const;

/** Class prefixes emitted by the compiler (stable, derived from data-owl-id). */
export const OWL_CLASS = {
	/** Dark-mode override class prefix: owld-<data-owl-id>. */
	darkOverride: 'owld',
	/** Stacking class for mobile (authored in components). */
	stack: 'owl-stack',
	/** Light content-variant class (shown by default; hidden in dark media). */
	light: 'owl-light',
	/** Dark content-variant class (hidden by default; shown in dark media). */
	dark: 'owl-dark',
	/** Legacy logo pair aliases — treated as owl-light / owl-dark. */
	logoLight: 'logo-light',
	logoDark: 'logo-dark',
} as const;

export const OWL_SLOT_TYPES = ['text', 'url', 'image', 'color', 'boolean'] as const;
export type OwlSlotType = (typeof OWL_SLOT_TYPES)[number];

export type OwlIssueSeverity = 'error' | 'warning';

export type OwlIssue = {
	code: string;
	severity: OwlIssueSeverity;
	message: string;
	/** Stable element id the issue relates to, when applicable. */
	owlId?: string;
};

/** A slot extracted from a component/document. */
export type OwlSlot = {
	name: string;
	type: OwlSlotType;
	label?: string;
	/** Stable id of the element that owns the slot. */
	owlId: string;
};

export type OwlCompileContext = {
	/** Design tokens: token name -> literal value (e.g. { primary: '#0A2540' }). */
	tokens?: Record<string, string>;
	/** Template kind for marketing-specific lint rules. */
	kind?: 'transactional' | 'marketing';
	/** Preheader override; replaces [data-owl-preheader] text when set. */
	preheader?: string;
	/** When 'dark', dark styles are promoted onto inline style (forced preview). */
	colorScheme?: 'light' | 'dark';
};

export type OwlCompileResult = {
	html: string;
	issues: OwlIssue[];
	slots: OwlSlot[];
	ids: string[];
};

export type OwlSlotValues = Record<string, string | boolean>;

export const OWL_FILLER = '\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c\u00a0\u200c';
