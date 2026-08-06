import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
	normalizeBareDesignAssetUrlsInDocument,
	normalizeBareDesignAssetUrlsInHtml,
	normalizeDesignAssetSlotValues,
} from '$lib/design-asset-urls';
import { db, rawDb } from './index';

const migrationsFolder = join(process.cwd(), 'drizzle');

/**
 * Apply versioned SQL migrations from `drizzle/`.
 * Existing installs that predate the journal are baselined so `0000_init`
 * is recorded as applied without re-running CREATE TABLE statements.
 */
export function migrate() {
	if (!existsSync(join(migrationsFolder, 'meta/_journal.json'))) {
		throw new Error(
			`Missing drizzle migrations at ${migrationsFolder}. Run from the repo root / image that includes drizzle/.`,
		);
	}

	baselineExistingInstallIfNeeded();
	drizzleMigrate(db, { migrationsFolder });

	// Idempotent content repairs for databases that already had rows
	// before schema was fully normalized.
	backfillDomainIds('templates');
	backfillDomainIds('contact_books');
	backfillDomainIds('suppression_list');
	backfillTemplateElementOrders();
	migrateHeroImageOverlay();
	clearHeroImageDefaultBlackBackground();
	normalizeBareDesignAssetRefs();

	console.log('Database migrated');
}

/** Mark baseline migration applied when schema already exists from the legacy migrator. */
function baselineExistingInstallIfNeeded() {
	const usersTable = rawDb
		.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
		.get() as { name: string } | undefined;
	if (!usersTable) return;

	rawDb.exec(`
		CREATE TABLE IF NOT EXISTS __drizzle_migrations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			hash text NOT NULL,
			created_at numeric
		)
	`);

	const already = rawDb.prepare(`SELECT id FROM __drizzle_migrations LIMIT 1`).get() as
		{ id: number } | undefined;
	if (already) return;

	const journal = JSON.parse(
		readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
	) as { entries: Array<{ tag: string; when: number }> };
	const entry = journal.entries[0];
	if (!entry) return;

	const sqlText = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf8');
	const hash = createHash('sha256').update(sqlText).digest('hex');
	rawDb
		.prepare(`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)`)
		.run(hash, entry.when);
	console.log(`Baselined existing database with migration ${entry.tag}`);
}

function backfillTemplateElementOrders() {
	const needsBackfill = rawDb
		.prepare(
			`SELECT 1 AS ok FROM template_elements
			 GROUP BY template_id
			 HAVING COUNT(*) > 1 AND COUNT(DISTINCT "order") = 1
			 LIMIT 1`,
		)
		.get() as { ok: number } | undefined;
	if (!needsBackfill) return;

	rawDb.exec(`
UPDATE template_elements
SET "order" = (
  SELECT COUNT(*) - 1
  FROM template_elements AS te2
  WHERE te2.template_id = template_elements.template_id
    AND (
      te2.created_at < template_elements.created_at
      OR (te2.created_at = template_elements.created_at AND te2.id <= template_elements.id)
    )
)
`);
}

function backfillDomainIds(table: string) {
	rawDb.exec(`
UPDATE ${table}
SET domain_id = (
  SELECT d.id FROM domains d
  WHERE d.team_id = ${table}.team_id
  ORDER BY d.id ASC
  LIMIT 1
)
WHERE domain_id IS NULL
  AND EXISTS (
    SELECT 1 FROM domains d WHERE d.team_id = ${table}.team_id
  )
`);
}

/**
 * Rewrite stacked Image+Text "Hero Image" components into a Container with
 * background-image + nested Text overlay. Idempotent: skips rows that already
 * have a Container with style.backgroundImage.
 */
function migrateHeroImageOverlay() {
	const rows = rawDb
		.prepare(
			`SELECT id, document, slots FROM design_components
			 WHERE name = 'Hero Image' AND document IS NOT NULL AND document != ''`,
		)
		.all() as Array<{ id: string; document: string; slots: string }>;

	const update = rawDb.prepare(
		`UPDATE design_components SET document = ?, slots = ?, updated_at = datetime('now') WHERE id = ?`,
	);

	for (const row of rows) {
		let doc: Record<string, { type: string; data: Record<string, unknown> }>;
		try {
			doc = JSON.parse(row.document) as typeof doc;
		} catch {
			continue;
		}
		if (!doc?.root || doc.root.type !== 'EmailLayout') continue;

		const alreadyOverlay = Object.values(doc).some((block) => {
			if (block?.type !== 'Container') return false;
			const style = block.data?.style as { backgroundImage?: string } | undefined;
			return Boolean(style?.backgroundImage);
		});
		if (alreadyOverlay) continue;

		let imageUrl = '';
		let titleText = 'Take Control of Your Data';
		for (const block of Object.values(doc)) {
			if (block?.type === 'Image') {
				const props = block.data?.props as { url?: string } | undefined;
				if (props?.url) imageUrl = props.url;
			}
			if (block?.type === 'Text' || block?.type === 'Heading') {
				const props = block.data?.props as { text?: string } | undefined;
				if (props?.text) titleText = props.text;
			}
		}
		if (!imageUrl) continue;

		const rootData = doc.root.data as {
			backdropColor?: string;
			canvasColor?: string;
			textColor?: string;
			fontFamily?: string;
		};

		const nextDoc = {
			root: {
				type: 'EmailLayout',
				data: {
					backdropColor: rootData.backdropColor ?? '#F5F5F5',
					canvasColor: rootData.canvasColor ?? '#FFFFFF',
					textColor: rootData.textColor ?? '#262626',
					fontFamily: rootData.fontFamily ?? 'MODERN_SANS',
					childrenIds: ['hero'],
				},
			},
			hero: {
				type: 'Container',
				data: {
					style: {
						backgroundImage: imageUrl,
						backgroundSize: 'cover',
						backgroundPosition: 'center',
						backgroundRepeat: 'no-repeat',
						minHeight: 280,
						padding: { top: 48, bottom: 48, left: 32, right: 32 },
					},
					props: { childrenIds: ['hero-title'] },
				},
			},
			'hero-title': {
				type: 'Text',
				data: {
					props: { text: titleText, markdown: true },
					style: {
						padding: { top: 0, bottom: 0, left: 0, right: 0 },
						fontWeight: 'bold',
						color: '#FFFFFF',
						textAlign: 'center',
						fontSize: 28,
					},
				},
			},
		};

		const nextSlots = [
			{
				name: 'hero_image_url',
				blockId: 'hero',
				prop: 'style.backgroundImage',
				type: 'asset',
				label: 'Hero Image URL',
			},
			{
				name: 'hero_title_text',
				blockId: 'hero-title',
				prop: 'props.text',
				type: 'text',
				label: 'Title Text',
			},
		];

		update.run(JSON.stringify(nextDoc), JSON.stringify(nextSlots), row.id);
	}
}

/** Remove migration-baked black fills so transparent PNGs stay transparent. */
function clearHeroImageDefaultBlackBackground() {
	const rows = rawDb
		.prepare(
			`SELECT id, document FROM design_components
			 WHERE name = 'Hero Image' AND document IS NOT NULL AND document != ''`,
		)
		.all() as Array<{ id: string; document: string }>;

	const update = rawDb.prepare(
		`UPDATE design_components SET document = ?, updated_at = datetime('now') WHERE id = ?`,
	);

	for (const row of rows) {
		let doc: Record<string, { type: string; data: Record<string, unknown> }>;
		try {
			doc = JSON.parse(row.document) as typeof doc;
		} catch {
			continue;
		}
		let changed = false;
		for (const block of Object.values(doc)) {
			if (block?.type !== 'Container') continue;
			const style = block.data?.style as
				{ backgroundImage?: string; backgroundColor?: string | null } | undefined;
			if (!style?.backgroundImage) continue;
			if (style.backgroundColor !== '#000000') continue;
			delete style.backgroundColor;
			changed = true;
		}
		if (changed) update.run(JSON.stringify(doc), row.id);
	}
}

/**
 * Rewrite bare design-asset ids (legacy cuid / sha256) to `/api/design-asset/{id}`
 * in stored Owl slotValues, email-builder documents, and compiled HTML.
 * Idempotent: already-prefixed URLs are left alone.
 */
function normalizeBareDesignAssetRefs() {
	normalizeTemplateAssetRefs();
	normalizeDesignComponentAssetRefs();
}

function normalizeTemplateAssetRefs() {
	const rows = rawDb
		.prepare(
			`SELECT id, content, html FROM templates
			 WHERE (content IS NOT NULL AND content != '')
			    OR (html IS NOT NULL AND html != '')`,
		)
		.all() as Array<{ id: string; content: string | null; html: string | null }>;

	const update = rawDb.prepare(
		`UPDATE templates SET content = ?, html = ?, updated_at = datetime('now') WHERE id = ?`,
	);

	for (const row of rows) {
		let content = row.content;
		let html = row.html;
		let changed = false;

		if (content) {
			const next = normalizeStoredContent(content);
			if (next !== content) {
				content = next;
				changed = true;
			}
		}
		if (html) {
			const next = normalizeBareDesignAssetUrlsInHtml(html);
			if (next !== html) {
				html = next;
				changed = true;
			}
		}
		if (changed) update.run(content, html, row.id);
	}
}

function normalizeDesignComponentAssetRefs() {
	const rows = rawDb
		.prepare(
			`SELECT id, document, html FROM design_components
			 WHERE (document IS NOT NULL AND document != '')
			    OR (html IS NOT NULL AND html != '')`,
		)
		.all() as Array<{ id: string; document: string; html: string }>;

	const update = rawDb.prepare(
		`UPDATE design_components SET document = ?, html = ?, updated_at = datetime('now') WHERE id = ?`,
	);

	for (const row of rows) {
		let document = row.document ?? '';
		let html = row.html ?? '';
		let changed = false;

		if (document) {
			try {
				const parsed = JSON.parse(document) as Record<
					string,
					{ type?: string; data?: Record<string, unknown> }
				>;
				if (normalizeBareDesignAssetUrlsInDocument(parsed)) {
					document = JSON.stringify(parsed);
					changed = true;
				}
			} catch {
				// ignore invalid JSON
			}
		}
		if (html) {
			const next = normalizeBareDesignAssetUrlsInHtml(html);
			if (next !== html) {
				html = next;
				changed = true;
			}
		}
		if (changed) update.run(document, html, row.id);
	}
}

/** Normalize Owl slotValues or email-builder document trees inside templates.content. */
function normalizeStoredContent(content: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return normalizeBareDesignAssetUrlsInHtml(content);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return content;

	const obj = parsed as Record<string, unknown>;
	let changed = false;

	// OwlDoc envelope
	if (obj.owl === 'v1' && obj.slotValues && typeof obj.slotValues === 'object') {
		const prev = obj.slotValues as Record<string, string>;
		const next = normalizeDesignAssetSlotValues(prev);
		if (next !== prev) {
			obj.slotValues = next;
			changed = true;
		}
		if (Array.isArray(obj.sections)) {
			for (const section of obj.sections as Array<{ html?: string }>) {
				if (typeof section?.html !== 'string') continue;
				const html = normalizeBareDesignAssetUrlsInHtml(section.html);
				if (html !== section.html) {
					section.html = html;
					changed = true;
				}
			}
		}
	}

	// Legacy email-builder envelope
	if (obj.format === 'email-builder' && obj.document && typeof obj.document === 'object') {
		if (
			normalizeBareDesignAssetUrlsInDocument(
				obj.document as Record<string, { type?: string; data?: Record<string, unknown> }>,
			)
		) {
			changed = true;
		}
		const scaffold = obj.scaffold as { slots?: Record<string, string> } | undefined;
		if (scaffold?.slots && typeof scaffold.slots === 'object') {
			const next = normalizeDesignAssetSlotValues(scaffold.slots);
			if (next !== scaffold.slots) {
				scaffold.slots = next;
				changed = true;
			}
		}
	}

	return changed ? JSON.stringify(obj) : content;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	migrate();
}
