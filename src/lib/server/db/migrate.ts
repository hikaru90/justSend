import { sql } from 'drizzle-orm';
import { db, rawDb } from './index';

/** Apply the initial schema via drizzle push-style CREATE IF NOT EXISTS statements. */
export function migrate() {
	rawDb.exec(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ses_settings (
  id TEXT PRIMARY KEY NOT NULL,
  region TEXT NOT NULL UNIQUE,
  id_prefix TEXT NOT NULL UNIQUE,
  topic TEXT NOT NULL,
  topic_arn TEXT,
  transactional_quota INTEGER NOT NULL DEFAULT 50,
  callback_url TEXT NOT NULL,
  callback_success INTEGER NOT NULL DEFAULT 0,
  config_general TEXT,
  config_general_success INTEGER NOT NULL DEFAULT 0,
  config_click TEXT,
  config_click_success INTEGER NOT NULL DEFAULT 0,
  config_open TEXT,
  config_open_success INTEGER NOT NULL DEFAULT 0,
  config_full TEXT,
  config_full_success INTEGER NOT NULL DEFAULT 0,
  ses_email_rate_limit INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT,
  email TEXT UNIQUE,
  email_verified TEXT,
  image TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  refresh_token_expires_in INTEGER,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_idx ON accounts(provider, provider_account_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS verification_tokens_identifier_token_idx ON verification_tokens(identifier, token);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  api_rate_limit INTEGER NOT NULL DEFAULT 2,
  ses_tenant_id TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0,
  daily_email_limit INTEGER NOT NULL DEFAULT 10000,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_team_email_idx ON team_invites(team_id, email);
CREATE TABLE IF NOT EXISTS team_users (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  region TEXT NOT NULL DEFAULT 'us-east-1',
  click_tracking INTEGER NOT NULL DEFAULT 0,
  open_tracking INTEGER NOT NULL DEFAULT 0,
  public_key TEXT NOT NULL,
  dkim_selector TEXT DEFAULT 'owlery',
  dkim_status TEXT,
  spf_details TEXT,
  dmarc_added INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  subdomain TEXT,
  ses_tenant_id TEXT,
  is_verifying INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  client_id TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL,
  partial_token TEXT NOT NULL,
  name TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'SENDING',
  domain_id INTEGER REFERENCES domains(id) ON DELETE SET NULL,
  last_used TEXT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY NOT NULL,
  ses_email_id TEXT UNIQUE,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  reply_to TEXT NOT NULL DEFAULT '[]',
  cc TEXT NOT NULL DEFAULT '[]',
  bcc TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  text TEXT,
  html TEXT,
  latest_status TEXT NOT NULL DEFAULT 'QUEUED',
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  domain_id INTEGER,
  api_id INTEGER,
  scheduled_at TEXT,
  attachments TEXT,
  campaign_id TEXT,
  contact_id TEXT,
  in_reply_to_id TEXT,
  headers TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS emails_campaign_contact_idx ON emails(campaign_id, contact_id);
CREATE INDEX IF NOT EXISTS emails_created_at_idx ON emails(created_at);
CREATE TABLE IF NOT EXISTS campaign_emails (
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  email_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (campaign_id, contact_id)
);
CREATE TABLE IF NOT EXISTS email_events (
  id TEXT PRIMARY KEY NOT NULL,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  data TEXT,
  team_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS email_events_email_id_idx ON email_events(email_id);
CREATE INDEX IF NOT EXISTS email_events_team_id_idx ON email_events(team_id);
CREATE TABLE IF NOT EXISTS contact_books (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  variables TEXT NOT NULL DEFAULT '[]',
  properties TEXT NOT NULL DEFAULT '{}',
  double_opt_in_enabled INTEGER NOT NULL DEFAULT 0,
  double_opt_in_from TEXT,
  double_opt_in_subject TEXT,
  double_opt_in_content TEXT,
  emoji TEXT NOT NULL DEFAULT '📙',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contact_books_team_id_idx ON contact_books(team_id);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY NOT NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT NOT NULL,
  subscribed INTEGER NOT NULL DEFAULT 1,
  unsubscribe_reason TEXT,
  properties TEXT NOT NULL DEFAULT '{}',
  contact_book_id TEXT NOT NULL REFERENCES contact_books(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_book_email_idx ON contacts(contact_book_id, email);
CREATE INDEX IF NOT EXISTS contacts_book_id_idx ON contacts(contact_book_id, id);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  "from" TEXT NOT NULL,
  cc TEXT NOT NULL DEFAULT '[]',
  bcc TEXT NOT NULL DEFAULT '[]',
  reply_to TEXT NOT NULL DEFAULT '[]',
  domain_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT,
  html TEXT,
  content TEXT,
  contact_book_id TEXT,
  scheduled_at TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  clicked INTEGER NOT NULL DEFAULT 0,
  unsubscribed INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  hard_bounced INTEGER NOT NULL DEFAULT 0,
  complained INTEGER NOT NULL DEFAULT 0,
  is_api INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  batch_size INTEGER NOT NULL DEFAULT 500,
  batch_window_minutes INTEGER NOT NULL DEFAULT 0,
  last_cursor TEXT,
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS campaigns_created_at_idx ON campaigns(created_at);
CREATE INDEX IF NOT EXISTS campaigns_status_scheduled_idx ON campaigns(status, scheduled_at);
CREATE TABLE IF NOT EXISTS automation_flows (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  trigger_type TEXT NOT NULL DEFAULT 'contact.created',
  trigger_config TEXT NOT NULL DEFAULT '{}',
  graph TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS automation_flows_team_status_idx ON automation_flows(team_id, status);
CREATE TABLE IF NOT EXISTS automation_enrollments (
  id TEXT PRIMARY KEY NOT NULL,
  flow_id TEXT NOT NULL REFERENCES automation_flows(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_node_id TEXT,
  wait_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS automation_enrollments_flow_status_idx ON automation_enrollments(flow_id, status);
CREATE INDEX IF NOT EXISTS automation_enrollments_contact_idx ON automation_enrollments(contact_id);
CREATE TABLE IF NOT EXISTS automation_execution_log (
  id TEXT PRIMARY KEY NOT NULL,
  flow_id TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  node_id TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS automation_execution_log_enrollment_idx ON automation_execution_log(enrollment_id);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  html TEXT,
  content TEXT,
  prompt TEXT,
  design_snapshot TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS templates_created_at_idx ON templates(created_at);
CREATE TABLE IF NOT EXISTS design_systems (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  design_md TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS design_systems_team_id_idx ON design_systems(team_id);
CREATE TABLE IF NOT EXISTS design_assets (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS design_assets_team_id_idx ON design_assets(team_id);
CREATE TABLE IF NOT EXISTS design_components (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  role TEXT NOT NULL DEFAULT 'section',
  description TEXT,
  props TEXT NOT NULL DEFAULT '[]',
  starter_key TEXT,
  html TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS design_components_team_id_idx ON design_components(team_id);
CREATE TABLE IF NOT EXISTS template_elements (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL DEFAULT '{}',
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS template_elements_template_id_idx ON template_elements(template_id);
CREATE TABLE IF NOT EXISTS template_components (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'component',
  source_type TEXT NOT NULL DEFAULT 'custom',
  design_component_id TEXT REFERENCES design_components(id) ON DELETE SET NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS template_components_template_id_idx ON template_components(template_id);
CREATE TABLE IF NOT EXISTS daily_email_usages (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  domain_id INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  clicked INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  complained INTEGER NOT NULL DEFAULT 0,
  hard_bounced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (team_id, domain_id, date, type)
);
CREATE TABLE IF NOT EXISTS cumulated_metrics (
  team_id INTEGER NOT NULL,
  domain_id INTEGER NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  hard_bounced INTEGER NOT NULL DEFAULT 0,
  complained INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, domain_id)
);
CREATE TABLE IF NOT EXISTS suppression_list (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS suppression_team_email_idx ON suppression_list(team_id, email);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  domain_ids TEXT NOT NULL DEFAULT '[]',
  url TEXT NOT NULL,
  description TEXT,
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  event_types TEXT NOT NULL DEFAULT '[]',
  api_version TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_at TEXT,
  last_success_at TEXT,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS webhooks_team_id_idx ON webhooks(team_id);
CREATE TABLE IF NOT EXISTS webhook_calls (
  id TEXT PRIMARY KEY NOT NULL,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  response_status INTEGER,
  response_time_ms INTEGER,
  response_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS webhook_calls_team_webhook_status_idx ON webhook_calls(team_id, webhook_id, status);
CREATE INDEX IF NOT EXISTS webhook_calls_created_at_idx ON webhook_calls(created_at);
CREATE TABLE IF NOT EXISTS queue_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  queue TEXT NOT NULL,
  job_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT,
  locked_by TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS queue_jobs_poll_idx ON queue_jobs(queue, status, run_at);
CREATE UNIQUE INDEX IF NOT EXISTS queue_jobs_queue_job_id_idx ON queue_jobs(queue, job_id);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY NOT NULL,
  team_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_team_key_idx ON idempotency_keys(team_id, key);
`);

	addColumnIfMissing('templates', 'domain_id', 'INTEGER REFERENCES domains(id) ON DELETE CASCADE');
	addColumnIfMissing('templates', 'prompt', 'TEXT');
	addColumnIfMissing('templates', 'design_snapshot', 'TEXT');
	addColumnIfMissing('templates', 'tags', "TEXT NOT NULL DEFAULT '[]'");
	addColumnIfMissing('design_components', 'kind', "TEXT NOT NULL DEFAULT 'custom'");
	addColumnIfMissing('design_components', 'role', "TEXT NOT NULL DEFAULT 'section'");
	addColumnIfMissing('design_components', 'props', "TEXT NOT NULL DEFAULT '[]'");
	addColumnIfMissing('design_components', 'starter_key', 'TEXT');
	addColumnIfMissing('design_components', 'document', "TEXT NOT NULL DEFAULT ''");
	addColumnIfMissing('design_components', 'slots', "TEXT NOT NULL DEFAULT '[]'");
	// Starter HTML kit is deprecated — components are authored as block trees.
	rawDb.exec(`DELETE FROM design_components WHERE kind = 'starter' OR starter_key IS NOT NULL`);
	addColumnIfMissing('template_components', 'source_type', "TEXT NOT NULL DEFAULT 'custom'");
	addColumnIfMissing(
		'template_components',
		'design_component_id',
		'TEXT REFERENCES design_components(id) ON DELETE SET NULL'
	);
	addColumnIfMissing('template_components', 'locked', 'INTEGER NOT NULL DEFAULT 0');
	addColumnIfMissing(
		'contact_books',
		'domain_id',
		'INTEGER REFERENCES domains(id) ON DELETE CASCADE'
	);
	addColumnIfMissing(
		'suppression_list',
		'domain_id',
		'INTEGER REFERENCES domains(id) ON DELETE CASCADE'
	);
	addColumnIfMissing('template_elements', 'order', 'INTEGER NOT NULL DEFAULT 0');

	rawDb.exec(`
CREATE INDEX IF NOT EXISTS templates_team_domain_idx ON templates(team_id, domain_id);
CREATE INDEX IF NOT EXISTS contact_books_team_domain_idx ON contact_books(team_id, domain_id);
CREATE INDEX IF NOT EXISTS suppression_team_domain_idx ON suppression_list(team_id, domain_id);
`);

	backfillDomainIds('templates');
	backfillDomainIds('contact_books');
	backfillDomainIds('suppression_list');
	backfillTemplateElementOrders();
	migrateHeroImageOverlay();
	clearHeroImageDefaultBlackBackground();

	db.run(sql`SELECT 1`);
	console.log('Database migrated');
}

function addColumnIfMissing(table: string, column: string, definition: string) {
	const columns = rawDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	if (columns.some((c) => c.name === column)) return;
	rawDb.exec(`ALTER TABLE ${table} ADD COLUMN "${column}" ${definition}`);
}

function backfillTemplateElementOrders() {
	const needsBackfill = rawDb
		.prepare(
			`SELECT 1 AS ok FROM template_elements
			 GROUP BY template_id
			 HAVING COUNT(*) > 1 AND COUNT(DISTINCT "order") = 1
			 LIMIT 1`
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
			 WHERE name = 'Hero Image' AND document IS NOT NULL AND document != ''`
		)
		.all() as Array<{ id: string; document: string; slots: string }>;

	const update = rawDb.prepare(
		`UPDATE design_components SET document = ?, slots = ?, updated_at = datetime('now') WHERE id = ?`
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
					childrenIds: ['hero']
				}
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
						padding: { top: 48, bottom: 48, left: 32, right: 32 }
					},
					props: { childrenIds: ['hero-title'] }
				}
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
						fontSize: 28
					}
				}
			}
		};

		const nextSlots = [
			{
				name: 'hero_image_url',
				blockId: 'hero',
				prop: 'style.backgroundImage',
				type: 'asset',
				label: 'Hero Image URL'
			},
			{
				name: 'hero_title_text',
				blockId: 'hero-title',
				prop: 'props.text',
				type: 'text',
				label: 'Title Text'
			}
		];

		update.run(JSON.stringify(nextDoc), JSON.stringify(nextSlots), row.id);
	}
}

/** Remove migration-baked black fills so transparent PNGs stay transparent. */
function clearHeroImageDefaultBlackBackground() {
	const rows = rawDb
		.prepare(
			`SELECT id, document FROM design_components
			 WHERE name = 'Hero Image' AND document IS NOT NULL AND document != ''`
		)
		.all() as Array<{ id: string; document: string }>;

	const update = rawDb.prepare(
		`UPDATE design_components SET document = ?, updated_at = datetime('now') WHERE id = ?`
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
				| { backgroundImage?: string; backgroundColor?: string | null }
				| undefined;
			if (!style?.backgroundImage) continue;
			if (style.backgroundColor !== '#000000') continue;
			delete style.backgroundColor;
			changed = true;
		}
		if (changed) update.run(JSON.stringify(doc), row.id);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	migrate();
}
