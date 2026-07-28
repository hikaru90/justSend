import { relations, sql } from 'drizzle-orm';
import {
	sqliteTable,
	text,
	integer,
	real,
	primaryKey,
	uniqueIndex,
	index
} from 'drizzle-orm/sqlite-core';

export const roles = ['ADMIN', 'MEMBER'] as const;
export type Role = (typeof roles)[number];

export const domainStatuses = [
	'NOT_STARTED',
	'PENDING',
	'SUCCESS',
	'FAILED',
	'TEMPORARY_FAILURE'
] as const;
export type DomainStatus = (typeof domainStatuses)[number];

export const apiPermissions = ['FULL', 'SENDING'] as const;
export type ApiPermission = (typeof apiPermissions)[number];

export const emailStatuses = [
	'SCHEDULED',
	'QUEUED',
	'SENT',
	'DELIVERY_DELAYED',
	'BOUNCED',
	'REJECTED',
	'RENDERING_FAILURE',
	'DELIVERED',
	'OPENED',
	'CLICKED',
	'COMPLAINED',
	'FAILED',
	'CANCELLED',
	'SUPPRESSED'
] as const;
export type EmailStatus = (typeof emailStatuses)[number];

export const campaignStatuses = ['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'SENT'] as const;
export type CampaignStatus = (typeof campaignStatuses)[number];

export const automationFlowStatuses = ['draft', 'active', 'paused'] as const;
export type AutomationFlowStatus = (typeof automationFlowStatuses)[number];

export const automationEnrollmentStatuses = ['active', 'completed', 'exited'] as const;
export type AutomationEnrollmentStatus = (typeof automationEnrollmentStatuses)[number];

export const automationExecutionEvents = [
	'entered',
	'email_queued',
	'wait_scheduled',
	'completed',
	'error'
] as const;
export type AutomationExecutionEvent = (typeof automationExecutionEvents)[number];

export const emailUsageTypes = ['TRANSACTIONAL', 'MARKETING'] as const;
export type EmailUsageType = (typeof emailUsageTypes)[number];

export const unsubscribeReasons = ['BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED'] as const;
export type UnsubscribeReason = (typeof unsubscribeReasons)[number];

export const suppressionReasons = ['HARD_BOUNCE', 'COMPLAINT', 'MANUAL'] as const;
export type SuppressionReason = (typeof suppressionReasons)[number];

export const webhookStatuses = ['ACTIVE', 'PAUSED', 'AUTO_DISABLED'] as const;
export type WebhookStatus = (typeof webhookStatuses)[number];

export const webhookCallStatuses = [
	'PENDING',
	'IN_PROGRESS',
	'DELIVERED',
	'FAILED',
	'DISCARDED'
] as const;
export type WebhookCallStatus = (typeof webhookCallStatuses)[number];

export const queueJobStatuses = ['pending', 'processing', 'completed', 'failed'] as const;
export type QueueJobStatus = (typeof queueJobStatuses)[number];

export const designAssetKinds = ['font', 'image', 'logo'] as const;
export type DesignAssetKind = (typeof designAssetKinds)[number];

export const templateElementTypes = ['logo', 'text', 'button', 'cta', 'link', 'image'] as const;
export type TemplateElementType = (typeof templateElementTypes)[number];

export const templateComponentKinds = ['root', 'component'] as const;
export type TemplateComponentKind = (typeof templateComponentKinds)[number];

const timestamps = {
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`),
	updatedAt: text('updated_at')
		.notNull()
		.default(sql`(datetime('now'))`)
};

export const appSettings = sqliteTable('app_settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export const sesSettings = sqliteTable('ses_settings', {
	id: text('id').primaryKey(),
	region: text('region').notNull().unique(),
	idPrefix: text('id_prefix').notNull().unique(),
	topic: text('topic').notNull(),
	topicArn: text('topic_arn'),
	transactionalQuota: integer('transactional_quota').notNull().default(50),
	callbackUrl: text('callback_url').notNull(),
	callbackSuccess: integer('callback_success', { mode: 'boolean' }).notNull().default(false),
	configGeneral: text('config_general'),
	configGeneralSuccess: integer('config_general_success', { mode: 'boolean' })
		.notNull()
		.default(false),
	configClick: text('config_click'),
	configClickSuccess: integer('config_click_success', { mode: 'boolean' }).notNull().default(false),
	configOpen: text('config_open'),
	configOpenSuccess: integer('config_open_success', { mode: 'boolean' }).notNull().default(false),
	configFull: text('config_full'),
	configFullSuccess: integer('config_full_success', { mode: 'boolean' }).notNull().default(false),
	sesEmailRateLimit: integer('ses_email_rate_limit').notNull().default(1),
	...timestamps
});

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name'),
	email: text('email').unique(),
	emailVerified: text('email_verified'),
	image: text('image'),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(datetime('now'))`)
});

export const accounts = sqliteTable(
	'accounts',
	{
		id: text('id').primaryKey(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		provider: text('provider').notNull(),
		providerAccountId: text('provider_account_id').notNull(),
		refreshToken: text('refresh_token'),
		accessToken: text('access_token'),
		refreshTokenExpiresIn: integer('refresh_token_expires_in'),
		expiresAt: integer('expires_at'),
		tokenType: text('token_type'),
		scope: text('scope'),
		idToken: text('id_token'),
		sessionState: text('session_state')
	},
	(t) => [uniqueIndex('accounts_provider_account_idx').on(t.provider, t.providerAccountId)]
);

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	sessionToken: text('session_token').notNull().unique(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expires: text('expires').notNull()
});

export const verificationTokens = sqliteTable(
	'verification_tokens',
	{
		identifier: text('identifier').notNull(),
		token: text('token').notNull().unique(),
		expires: text('expires').notNull()
	},
	(t) => [uniqueIndex('verification_tokens_identifier_token_idx').on(t.identifier, t.token)]
);

export const teams = sqliteTable('teams', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
	apiRateLimit: integer('api_rate_limit').notNull().default(2),
	sesTenantId: text('ses_tenant_id'),
	isVerified: integer('is_verified', { mode: 'boolean' }).notNull().default(false),
	dailyEmailLimit: integer('daily_email_limit').notNull().default(10000),
	isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
	...timestamps
});

export const teamInvites = sqliteTable(
	'team_invites',
	{
		id: text('id').primaryKey(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		role: text('role', { enum: roles }).notNull(),
		...timestamps
	},
	(t) => [uniqueIndex('team_invites_team_email_idx').on(t.teamId, t.email)]
);

export const teamUsers = sqliteTable(
	'team_users',
	{
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role', { enum: roles }).notNull()
	},
	(t) => [primaryKey({ columns: [t.teamId, t.userId] })]
);

export const domains = sqliteTable('domains', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	teamId: integer('team_id')
		.notNull()
		.references(() => teams.id, { onDelete: 'cascade' }),
	status: text('status', { enum: domainStatuses }).notNull().default('PENDING'),
	region: text('region').notNull().default('us-east-1'),
	clickTracking: integer('click_tracking', { mode: 'boolean' }).notNull().default(false),
	openTracking: integer('open_tracking', { mode: 'boolean' }).notNull().default(false),
	publicKey: text('public_key').notNull(),
	dkimSelector: text('dkim_selector').default('owlery'),
	dkimStatus: text('dkim_status'),
	spfDetails: text('spf_details'),
	dmarcAdded: integer('dmarc_added', { mode: 'boolean' }).notNull().default(false),
	errorMessage: text('error_message'),
	subdomain: text('subdomain'),
	sesTenantId: text('ses_tenant_id'),
	isVerifying: integer('is_verifying', { mode: 'boolean' }).notNull().default(false),
	...timestamps
});

export const apiKeys = sqliteTable('api_keys', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	clientId: text('client_id').notNull().unique(),
	tokenHash: text('token_hash').notNull(),
	partialToken: text('partial_token').notNull(),
	name: text('name').notNull(),
	permission: text('permission', { enum: apiPermissions }).notNull().default('SENDING'),
	domainId: integer('domain_id').references(() => domains.id, { onDelete: 'set null' }),
	lastUsed: text('last_used'),
	teamId: integer('team_id')
		.notNull()
		.references(() => teams.id, { onDelete: 'cascade' }),
	...timestamps
});

export const emails = sqliteTable(
	'emails',
	{
		id: text('id').primaryKey(),
		sesEmailId: text('ses_email_id').unique(),
		from: text('from').notNull(),
		to: text('to').notNull(), // JSON array
		replyTo: text('reply_to').notNull().default('[]'),
		cc: text('cc').notNull().default('[]'),
		bcc: text('bcc').notNull().default('[]'),
		subject: text('subject').notNull(),
		text: text('text'),
		html: text('html'),
		latestStatus: text('latest_status', { enum: emailStatuses }).notNull().default('QUEUED'),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		domainId: integer('domain_id'),
		apiId: integer('api_id'),
		scheduledAt: text('scheduled_at'),
		attachments: text('attachments'),
		campaignId: text('campaign_id'),
		contactId: text('contact_id'),
		inReplyToId: text('in_reply_to_id'),
		headers: text('headers'),
		...timestamps
	},
	(t) => [
		index('emails_campaign_contact_idx').on(t.campaignId, t.contactId),
		index('emails_created_at_idx').on(t.createdAt)
	]
);

export const campaignEmails = sqliteTable(
	'campaign_emails',
	{
		campaignId: text('campaign_id').notNull(),
		contactId: text('contact_id').notNull(),
		emailId: text('email_id').notNull(),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(t) => [primaryKey({ columns: [t.campaignId, t.contactId] })]
);

export const emailEvents = sqliteTable(
	'email_events',
	{
		id: text('id').primaryKey(),
		emailId: text('email_id')
			.notNull()
			.references(() => emails.id, { onDelete: 'cascade' }),
		status: text('status', { enum: emailStatuses }).notNull(),
		data: text('data'), // JSON
		teamId: integer('team_id'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(t) => [
		index('email_events_email_id_idx').on(t.emailId),
		index('email_events_team_id_idx').on(t.teamId)
	]
);

export const contactBooks = sqliteTable(
	'contact_books',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
		variables: text('variables').notNull().default('[]'), // JSON array
		properties: text('properties').notNull().default('{}'), // JSON
		doubleOptInEnabled: integer('double_opt_in_enabled', { mode: 'boolean' })
			.notNull()
			.default(false),
		doubleOptInFrom: text('double_opt_in_from'),
		doubleOptInSubject: text('double_opt_in_subject'),
		doubleOptInContent: text('double_opt_in_content'),
		emoji: text('emoji').notNull().default('📙'),
		...timestamps
	},
	(t) => [
		index('contact_books_team_id_idx').on(t.teamId),
		index('contact_books_team_domain_idx').on(t.teamId, t.domainId)
	]
);

export const contacts = sqliteTable(
	'contacts',
	{
		id: text('id').primaryKey(),
		firstName: text('first_name'),
		lastName: text('last_name'),
		email: text('email').notNull(),
		subscribed: integer('subscribed', { mode: 'boolean' }).notNull().default(true),
		unsubscribeReason: text('unsubscribe_reason', { enum: unsubscribeReasons }),
		properties: text('properties').notNull().default('{}'),
		contactBookId: text('contact_book_id')
			.notNull()
			.references(() => contactBooks.id, { onDelete: 'cascade' }),
		...timestamps
	},
	(t) => [
		uniqueIndex('contacts_book_email_idx').on(t.contactBookId, t.email),
		index('contacts_book_id_idx').on(t.contactBookId, t.id)
	]
);

export const campaigns = sqliteTable(
	'campaigns',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		from: text('from').notNull(),
		cc: text('cc').notNull().default('[]'),
		bcc: text('bcc').notNull().default('[]'),
		replyTo: text('reply_to').notNull().default('[]'),
		domainId: integer('domain_id').notNull(),
		subject: text('subject').notNull(),
		previewText: text('preview_text'),
		html: text('html'),
		content: text('content'),
		contactBookId: text('contact_book_id'),
		scheduledAt: text('scheduled_at'),
		total: integer('total').notNull().default(0),
		sent: integer('sent').notNull().default(0),
		delivered: integer('delivered').notNull().default(0),
		opened: integer('opened').notNull().default(0),
		clicked: integer('clicked').notNull().default(0),
		unsubscribed: integer('unsubscribed').notNull().default(0),
		bounced: integer('bounced').notNull().default(0),
		hardBounced: integer('hard_bounced').notNull().default(0),
		complained: integer('complained').notNull().default(0),
		isApi: integer('is_api', { mode: 'boolean' }).notNull().default(false),
		status: text('status', { enum: campaignStatuses }).notNull().default('DRAFT'),
		batchSize: integer('batch_size').notNull().default(500),
		batchWindowMinutes: integer('batch_window_minutes').notNull().default(0),
		lastCursor: text('last_cursor'),
		lastSentAt: text('last_sent_at'),
		...timestamps
	},
	(t) => [
		index('campaigns_created_at_idx').on(t.createdAt),
		index('campaigns_status_scheduled_idx').on(t.status, t.scheduledAt)
	]
);

export const templates = sqliteTable(
	'templates',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
		subject: text('subject').notNull(),
		html: text('html'),
		content: text('content'),
		prompt: text('prompt'),
		designSnapshot: text('design_snapshot'),
		...timestamps
	},
	(t) => [
		index('templates_created_at_idx').on(t.createdAt),
		index('templates_team_domain_idx').on(t.teamId, t.domainId)
	]
);

export const automationFlows = sqliteTable(
	'automation_flows',
	{
		id: text('id').primaryKey(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		domainId: integer('domain_id')
			.notNull()
			.references(() => domains.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		status: text('status', { enum: automationFlowStatuses }).notNull().default('draft'),
		triggerType: text('trigger_type').notNull().default('contact.created'),
		triggerConfig: text('trigger_config').notNull().default('{}'),
		graph: text('graph').notNull().default('{"nodes":[],"edges":[]}'),
		...timestamps
	},
	(t) => [index('automation_flows_team_status_idx').on(t.teamId, t.status)]
);

export const automationEnrollments = sqliteTable(
	'automation_enrollments',
	{
		id: text('id').primaryKey(),
		flowId: text('flow_id')
			.notNull()
			.references(() => automationFlows.id, { onDelete: 'cascade' }),
		contactId: text('contact_id').notNull(),
		status: text('status', { enum: automationEnrollmentStatuses }).notNull().default('active'),
		currentNodeId: text('current_node_id'),
		waitUntil: text('wait_until'),
		...timestamps
	},
	(t) => [
		index('automation_enrollments_flow_status_idx').on(t.flowId, t.status),
		index('automation_enrollments_contact_idx').on(t.contactId)
	]
);

export const automationExecutionLog = sqliteTable(
	'automation_execution_log',
	{
		id: text('id').primaryKey(),
		flowId: text('flow_id').notNull(),
		enrollmentId: text('enrollment_id').notNull(),
		nodeId: text('node_id'),
		event: text('event', { enum: automationExecutionEvents }).notNull(),
		detail: text('detail'),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(t) => [index('automation_execution_log_enrollment_idx').on(t.enrollmentId)]
);

export const designSystems = sqliteTable(
	'design_systems',
	{
		id: text('id').primaryKey(),
		teamId: integer('team_id')
			.notNull()
			.unique()
			.references(() => teams.id, { onDelete: 'cascade' }),
		designMd: text('design_md'),
		...timestamps
	},
	(t) => [uniqueIndex('design_systems_team_id_idx').on(t.teamId)]
);

export const designAssets = sqliteTable(
	'design_assets',
	{
		id: text('id').primaryKey(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: designAssetKinds }).notNull(),
		name: text('name').notNull(),
		filename: text('filename').notNull(),
		mime: text('mime').notNull(),
		size: integer('size').notNull(),
		...timestamps
	},
	(t) => [index('design_assets_team_id_idx').on(t.teamId)]
);

export const designComponents = sqliteTable(
	'design_components',
	{
		id: text('id').primaryKey(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		html: text('html').notNull().default(''),
		...timestamps
	},
	(t) => [index('design_components_team_id_idx').on(t.teamId)]
);

export const templateElements = sqliteTable(
	'template_elements',
	{
		id: text('id').primaryKey(),
		templateId: text('template_id')
			.notNull()
			.references(() => templates.id, { onDelete: 'cascade' }),
		type: text('type', { enum: templateElementTypes }).notNull(),
		label: text('label').notNull(),
		required: integer('required', { mode: 'boolean' }).notNull().default(true),
		config: text('config').notNull().default('{}'),
		...timestamps
	},
	(t) => [index('template_elements_template_id_idx').on(t.templateId)]
);

export const templateComponents = sqliteTable(
	'template_components',
	{
		id: text('id').primaryKey(),
		templateId: text('template_id')
			.notNull()
			.references(() => templates.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		kind: text('kind', { enum: templateComponentKinds }).notNull().default('component'),
		source: text('source').notNull().default(''),
		order: integer('order').notNull().default(0),
		...timestamps
	},
	(t) => [index('template_components_template_id_idx').on(t.templateId)]
);

export const dailyEmailUsages = sqliteTable(
	'daily_email_usages',
	{
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		date: text('date').notNull(),
		type: text('type', { enum: emailUsageTypes }).notNull(),
		domainId: integer('domain_id').notNull(),
		sent: integer('sent').notNull().default(0),
		delivered: integer('delivered').notNull().default(0),
		opened: integer('opened').notNull().default(0),
		clicked: integer('clicked').notNull().default(0),
		bounced: integer('bounced').notNull().default(0),
		complained: integer('complained').notNull().default(0),
		hardBounced: integer('hard_bounced').notNull().default(0),
		...timestamps
	},
	(t) => [primaryKey({ columns: [t.teamId, t.domainId, t.date, t.type] })]
);

export const cumulatedMetrics = sqliteTable(
	'cumulated_metrics',
	{
		teamId: integer('team_id').notNull(),
		domainId: integer('domain_id').notNull(),
		delivered: integer('delivered').notNull().default(0),
		hardBounced: integer('hard_bounced').notNull().default(0),
		complained: integer('complained').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.teamId, t.domainId] })]
);

export const suppressionList = sqliteTable(
	'suppression_list',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		domainId: integer('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
		reason: text('reason', { enum: suppressionReasons }).notNull(),
		source: text('source'),
		...timestamps
	},
	(t) => [
		uniqueIndex('suppression_team_email_idx').on(t.teamId, t.email),
		index('suppression_team_domain_idx').on(t.teamId, t.domainId)
	]
);

export const webhooks = sqliteTable(
	'webhooks',
	{
		id: text('id').primaryKey(),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		domainIds: text('domain_ids').notNull().default('[]'), // JSON number[]
		url: text('url').notNull(),
		description: text('description'),
		secret: text('secret').notNull(),
		status: text('status', { enum: webhookStatuses }).notNull().default('ACTIVE'),
		eventTypes: text('event_types').notNull().default('[]'), // JSON string[]
		apiVersion: text('api_version'),
		consecutiveFailures: integer('consecutive_failures').notNull().default(0),
		lastFailureAt: text('last_failure_at'),
		lastSuccessAt: text('last_success_at'),
		createdByUserId: integer('created_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		...timestamps
	},
	(t) => [index('webhooks_team_id_idx').on(t.teamId)]
);

export const webhookCalls = sqliteTable(
	'webhook_calls',
	{
		id: text('id').primaryKey(),
		webhookId: text('webhook_id')
			.notNull()
			.references(() => webhooks.id, { onDelete: 'cascade' }),
		teamId: integer('team_id')
			.notNull()
			.references(() => teams.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		payload: text('payload').notNull(),
		status: text('status', { enum: webhookCallStatuses }).notNull().default('PENDING'),
		attempt: integer('attempt').notNull().default(0),
		nextAttemptAt: text('next_attempt_at'),
		lastError: text('last_error'),
		responseStatus: integer('response_status'),
		responseTimeMs: integer('response_time_ms'),
		responseText: text('response_text'),
		...timestamps
	},
	(t) => [
		index('webhook_calls_team_webhook_status_idx').on(t.teamId, t.webhookId, t.status),
		index('webhook_calls_created_at_idx').on(t.createdAt)
	]
);

export const queueJobs = sqliteTable(
	'queue_jobs',
	{
		id: text('id').primaryKey(),
		queue: text('queue').notNull(),
		jobId: text('job_id'),
		payload: text('payload').notNull().default('{}'),
		status: text('status', { enum: queueJobStatuses }).notNull().default('pending'),
		attempts: integer('attempts').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(5),
		runAt: text('run_at')
			.notNull()
			.default(sql`(datetime('now'))`),
		lockedAt: text('locked_at'),
		lockedBy: text('locked_by'),
		lastError: text('last_error'),
		...timestamps
	},
	(t) => [
		index('queue_jobs_poll_idx').on(t.queue, t.status, t.runAt),
		uniqueIndex('queue_jobs_queue_job_id_idx').on(t.queue, t.jobId)
	]
);

export const idempotencyKeys = sqliteTable(
	'idempotency_keys',
	{
		id: text('id').primaryKey(),
		teamId: integer('team_id').notNull(),
		key: text('key').notNull(),
		response: text('response').notNull(),
		createdAt: text('created_at')
			.notNull()
			.default(sql`(datetime('now'))`)
	},
	(t) => [uniqueIndex('idempotency_team_key_idx').on(t.teamId, t.key)]
);

export const usersRelations = relations(users, ({ many }) => ({
	accounts: many(accounts),
	sessions: many(sessions),
	teamUsers: many(teamUsers)
}));

export const teamsRelations = relations(teams, ({ many }) => ({
	teamUsers: many(teamUsers),
	domains: many(domains),
	apiKeys: many(apiKeys),
	emails: many(emails)
}));
