CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`refresh_token_expires_in` integer,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_idx` ON `accounts` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`partial_token` text NOT NULL,
	`name` text NOT NULL,
	`permission` text DEFAULT 'SENDING' NOT NULL,
	`domain_id` integer,
	`last_used` text,
	`team_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_client_id_unique` ON `api_keys` (`client_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`current_node_id` text,
	`wait_until` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`flow_id`) REFERENCES `automation_flows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_enrollments_flow_status_idx` ON `automation_enrollments` (`flow_id`,`status`);--> statement-breakpoint
CREATE INDEX `automation_enrollments_contact_idx` ON `automation_enrollments` (`contact_id`);--> statement-breakpoint
CREATE TABLE `automation_execution_log` (
	`id` text PRIMARY KEY NOT NULL,
	`flow_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`node_id` text,
	`event` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `automation_execution_log_enrollment_idx` ON `automation_execution_log` (`enrollment_id`);--> statement-breakpoint
CREATE TABLE `automation_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`domain_id` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`trigger_type` text DEFAULT 'contact.created' NOT NULL,
	`trigger_config` text DEFAULT '{}' NOT NULL,
	`graph` text DEFAULT '{"nodes":[],"edges":[]}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_flows_team_status_idx` ON `automation_flows` (`team_id`,`status`);--> statement-breakpoint
CREATE TABLE `campaign_emails` (
	`campaign_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`email_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`campaign_id`, `contact_id`)
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`team_id` integer NOT NULL,
	`from` text NOT NULL,
	`cc` text DEFAULT '[]' NOT NULL,
	`bcc` text DEFAULT '[]' NOT NULL,
	`reply_to` text DEFAULT '[]' NOT NULL,
	`domain_id` integer NOT NULL,
	`subject` text NOT NULL,
	`preview_text` text,
	`html` text,
	`content` text,
	`contact_book_id` text,
	`scheduled_at` text,
	`total` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	`unsubscribed` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`hard_bounced` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	`is_api` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`batch_size` integer DEFAULT 500 NOT NULL,
	`batch_window_minutes` integer DEFAULT 0 NOT NULL,
	`last_cursor` text,
	`last_sent_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaigns_created_at_idx` ON `campaigns` (`created_at`);--> statement-breakpoint
CREATE INDEX `campaigns_status_scheduled_idx` ON `campaigns` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `contact_books` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`team_id` integer NOT NULL,
	`domain_id` integer,
	`variables` text DEFAULT '[]' NOT NULL,
	`properties` text DEFAULT '{}' NOT NULL,
	`double_opt_in_enabled` integer DEFAULT false NOT NULL,
	`double_opt_in_from` text,
	`double_opt_in_subject` text,
	`double_opt_in_content` text,
	`emoji` text DEFAULT '📙' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_books_team_id_idx` ON `contact_books` (`team_id`);--> statement-breakpoint
CREATE INDEX `contact_books_team_domain_idx` ON `contact_books` (`team_id`,`domain_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text,
	`last_name` text,
	`email` text NOT NULL,
	`subscribed` integer DEFAULT true NOT NULL,
	`unsubscribe_reason` text,
	`properties` text DEFAULT '{}' NOT NULL,
	`contact_book_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_book_id`) REFERENCES `contact_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_book_email_idx` ON `contacts` (`contact_book_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_book_id_idx` ON `contacts` (`contact_book_id`,`id`);--> statement-breakpoint
CREATE TABLE `cumulated_metrics` (
	`team_id` integer NOT NULL,
	`domain_id` integer NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`hard_bounced` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`team_id`, `domain_id`)
);
--> statement-breakpoint
CREATE TABLE `daily_email_usages` (
	`team_id` integer NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`domain_id` integer NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`delivered` integer DEFAULT 0 NOT NULL,
	`opened` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	`bounced` integer DEFAULT 0 NOT NULL,
	`complained` integer DEFAULT 0 NOT NULL,
	`hard_bounced` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`team_id`, `domain_id`, `date`, `type`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `design_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_assets_team_id_idx` ON `design_assets` (`team_id`);--> statement-breakpoint
CREATE TABLE `design_components` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`role` text DEFAULT 'section' NOT NULL,
	`description` text,
	`props` text DEFAULT '[]' NOT NULL,
	`starter_key` text,
	`html` text DEFAULT '' NOT NULL,
	`document` text DEFAULT '' NOT NULL,
	`slots` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `design_components_team_id_idx` ON `design_components` (`team_id`);--> statement-breakpoint
CREATE TABLE `design_systems` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`design_md` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_systems_team_id_unique` ON `design_systems` (`team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `design_systems_team_id_idx` ON `design_systems` (`team_id`);--> statement-breakpoint
CREATE TABLE `domains` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`team_id` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`region` text DEFAULT 'us-east-1' NOT NULL,
	`click_tracking` integer DEFAULT false NOT NULL,
	`open_tracking` integer DEFAULT false NOT NULL,
	`public_key` text NOT NULL,
	`dkim_selector` text DEFAULT 'owlery',
	`dkim_status` text,
	`spf_details` text,
	`dmarc_added` integer DEFAULT false NOT NULL,
	`error_message` text,
	`subdomain` text,
	`ses_tenant_id` text,
	`is_verifying` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_name_unique` ON `domains` (`name`);--> statement-breakpoint
CREATE TABLE `email_events` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`status` text NOT NULL,
	`data` text,
	`team_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_events_email_id_idx` ON `email_events` (`email_id`);--> statement-breakpoint
CREATE INDEX `email_events_team_id_idx` ON `email_events` (`team_id`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`ses_email_id` text,
	`from` text NOT NULL,
	`to` text NOT NULL,
	`reply_to` text DEFAULT '[]' NOT NULL,
	`cc` text DEFAULT '[]' NOT NULL,
	`bcc` text DEFAULT '[]' NOT NULL,
	`subject` text NOT NULL,
	`text` text,
	`html` text,
	`latest_status` text DEFAULT 'QUEUED' NOT NULL,
	`team_id` integer NOT NULL,
	`domain_id` integer,
	`api_id` integer,
	`scheduled_at` text,
	`attachments` text,
	`campaign_id` text,
	`contact_id` text,
	`in_reply_to_id` text,
	`headers` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `emails_ses_email_id_unique` ON `emails` (`ses_email_id`);--> statement-breakpoint
CREATE INDEX `emails_campaign_contact_idx` ON `emails` (`campaign_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `emails_created_at_idx` ON `emails` (`created_at`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`key` text NOT NULL,
	`response` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_team_key_idx` ON `idempotency_keys` (`team_id`,`key`);--> statement-breakpoint
CREATE TABLE `queue_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`queue` text NOT NULL,
	`job_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`run_at` text DEFAULT (datetime('now')) NOT NULL,
	`locked_at` text,
	`locked_by` text,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `queue_jobs_poll_idx` ON `queue_jobs` (`queue`,`status`,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_jobs_queue_job_id_idx` ON `queue_jobs` (`queue`,`job_id`);--> statement-breakpoint
CREATE TABLE `ses_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`region` text NOT NULL,
	`id_prefix` text NOT NULL,
	`topic` text NOT NULL,
	`topic_arn` text,
	`transactional_quota` integer DEFAULT 50 NOT NULL,
	`callback_url` text NOT NULL,
	`callback_success` integer DEFAULT false NOT NULL,
	`config_general` text,
	`config_general_success` integer DEFAULT false NOT NULL,
	`config_click` text,
	`config_click_success` integer DEFAULT false NOT NULL,
	`config_open` text,
	`config_open_success` integer DEFAULT false NOT NULL,
	`config_full` text,
	`config_full_success` integer DEFAULT false NOT NULL,
	`ses_email_rate_limit` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ses_settings_region_unique` ON `ses_settings` (`region`);--> statement-breakpoint
CREATE UNIQUE INDEX `ses_settings_id_prefix_unique` ON `ses_settings` (`id_prefix`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_token` text NOT NULL,
	`user_id` integer NOT NULL,
	`expires` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_session_token_unique` ON `sessions` (`session_token`);--> statement-breakpoint
CREATE TABLE `suppression_list` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`team_id` integer NOT NULL,
	`domain_id` integer,
	`reason` text NOT NULL,
	`source` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppression_team_email_idx` ON `suppression_list` (`team_id`,`email`);--> statement-breakpoint
CREATE INDEX `suppression_team_domain_idx` ON `suppression_list` (`team_id`,`domain_id`);--> statement-breakpoint
CREATE TABLE `team_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invites_team_email_idx` ON `team_invites` (`team_id`,`email`);--> statement-breakpoint
CREATE TABLE `team_users` (
	`team_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`team_id`, `user_id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`api_rate_limit` integer DEFAULT 2 NOT NULL,
	`ses_tenant_id` text,
	`is_verified` integer DEFAULT false NOT NULL,
	`daily_email_limit` integer DEFAULT 10000 NOT NULL,
	`is_blocked` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `template_components` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'component' NOT NULL,
	`source_type` text DEFAULT 'custom' NOT NULL,
	`design_component_id` text,
	`locked` integer DEFAULT false NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`design_component_id`) REFERENCES `design_components`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `template_components_template_id_idx` ON `template_components` (`template_id`);--> statement-breakpoint
CREATE TABLE `template_elements` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `template_elements_template_id_idx` ON `template_elements` (`template_id`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`team_id` integer NOT NULL,
	`domain_id` integer,
	`subject` text NOT NULL,
	`html` text,
	`content` text,
	`prompt` text,
	`design_snapshot` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`domain_id`) REFERENCES `domains`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `templates_created_at_idx` ON `templates` (`created_at`);--> statement-breakpoint
CREATE INDEX `templates_team_domain_idx` ON `templates` (`team_id`,`domain_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`email` text,
	`email_verified` text,
	`image` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_tokens_token_unique` ON `verification_tokens` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `verification_tokens_identifier_token_idx` ON `verification_tokens` (`identifier`,`token`);--> statement-breakpoint
CREATE TABLE `webhook_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`team_id` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`last_error` text,
	`response_status` integer,
	`response_time_ms` integer,
	`response_text` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_calls_team_webhook_status_idx` ON `webhook_calls` (`team_id`,`webhook_id`,`status`);--> statement-breakpoint
CREATE INDEX `webhook_calls_created_at_idx` ON `webhook_calls` (`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` integer NOT NULL,
	`domain_ids` text DEFAULT '[]' NOT NULL,
	`url` text NOT NULL,
	`description` text,
	`secret` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`event_types` text DEFAULT '[]' NOT NULL,
	`api_version` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_failure_at` text,
	`last_success_at` text,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhooks_team_id_idx` ON `webhooks` (`team_id`);