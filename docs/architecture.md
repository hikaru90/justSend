# Architecture

## High-level layout

```
src/
  hooks.server.ts          # migrate-on-boot + session/team/domain locals
  routes/
    (dashboard)/           # authenticated UI (form actions on +page.server.ts)
    api/
      auth/                # magic link, OAuth, logout
      v1/                  # public REST API (Bearer us_… keys)
      ses_callback/        # SNS → enqueue SES webhook jobs
      health/, unsubscribe-oneclick/, …
    login|signup|subscribe|unsubscribe|join-team/
  lib/
    server/
      db/                  # schema, drizzle client (WAL), migrate
      queue/               # enqueue + QueueWorker
      api/                 # auth, zod validate, errors, serialize
      aws/                 # SES + SNS clients
      service/             # domain logic (emails, campaigns, templates, …)
      auth/                # sessions, magic links, OAuth
    email-builder/         # visual block editor (Svelte)
    email-editor/          # HTML render path for stored editor content
    components/            # dashboard UI + flow nodes (xyflow)
  server/worker.ts         # background workers entry
scripts/
  supervisor.mjs           # prod: web + worker lifecycle
  build-worker.mjs         # esbuild bundle for worker
```

Legacy reference code lives in `useSend-legacy/` (Next.js / Prisma / Redis / Hono). Owlery is **not** a monorepo of that tree; it is a greenfield single package.

## Processes

| Process | Role |
|---------|------|
| **Web** | SvelteKit SSR/API. Serves dashboard, REST `/api/v1/*`, auth, SES SNS HTTP endpoint. Enqueues work; does not block on SES send for bulk paths. |
| **Worker** | Polls `queue_jobs`, claims with lock columns, runs handlers with retries/backoff. Heartbeats into `app_settings` for dashboard control. |
| **Supervisor** | Spawns both; restarts on crash; stops worker when desired state is `stopped`. |

Dev: `npm run dev:all` (Vite + `tsx watch` worker). Prod: `npm run build` then `npm run start`.

## Database

- **Engine:** SQLite via `better-sqlite3`, path from `DATABASE_URL` (default `file:./data/owlery.db`).
- **Pragmas:** `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`.
- **Migrations:** Applied at web/worker startup (`migrate()`).
- **Backup:** `backupDatabaseTo()` uses SQLite online backup (WAL-safe). Admin UI can download DB / export–import “parts” (design/template payloads).

### Core domain entities

| Area | Tables (selected) |
|------|-------------------|
| Tenancy | `users`, `sessions`, `accounts`, `teams`, `team_users`, `team_invites` |
| Sending identity | `domains`, `api_keys`, `ses_settings` |
| Mail | `emails`, `email_events`, `daily_email_usages`, `cumulated_metrics` |
| Audience | `contact_books`, `contacts`, `suppression_list` |
| Marketing | `campaigns`, `campaign_emails` |
| Automations | `automation_flows`, `automation_enrollments`, `automation_execution_log` |
| Content | `templates`, `template_elements`, `template_components`, `design_systems`, `design_assets`, `design_components` |
| Integrations | `webhooks`, `webhook_calls`, `idempotency_keys` |
| Infra | `queue_jobs`, `app_settings` |

Multi-tenancy is **team**-scoped. UI context also pins a **domain** (project) via cookies (`owlery_team`, `owlery_domain`).

## Request paths

### Dashboard

- Layout loaders attach user, teams, domains.
- Mutations use **SvelteKit form actions** on `+page.server.ts` only (not layouts) — see `AGENTS.md`.
- Admin routes (`/admin/*`) gated by `ADMIN_EMAIL`.

### Public REST API (`/api/v1`)

Authenticated with `Authorization: Bearer <token>` (`requireApiTeam`). Keys hash-verified; permissions `FULL` | `SENDING`; optional domain binding.

Notable resources:

- `POST/GET /emails`, `POST /emails/batch`, cancel by id
- Domains (list/verify)
- Contact books + contacts (+ bulk)
- Campaigns (CRUD, schedule, pause, resume)
- Analytics (time series, reputation metrics)

Idempotency via `Idempotency-Key` header stored in `idempotency_keys`.

### SES feedback

1. AWS SNS posts to `/api/ses_callback`.
2. Job enqueued on `ses-webhook`.
3. Worker `parseSesHook` updates email status/events, metrics, suppressions, and may enqueue outbound `webhook-dispatch` jobs.

## Job queue

Custom implementation in `src/lib/server/queue` — **no Redis**.

- Rows in `queue_jobs` with `status`, `run_at`, `attempts`, `locked_at` / `locked_by`.
- Optional `jobId` unique per queue for idempotent enqueue.
- Exponential backoff; stale lock recovery on worker start / periodic tick.

### Queue names

| Queue | Purpose |
|-------|---------|
| `{region}-transaction` | Transactional SES sends (rate from SES settings × transactional quota %) |
| `{region}-marketing` | Marketing SES sends |
| `ses-webhook` | Parse SNS/SES events |
| `webhook-dispatch` | HTTP callbacks to customer URLs |
| `campaign-batch` / `campaign-scheduler` | Batched campaign sending + due schedule poll |
| `contact-bulk-add` | Large contact imports |
| `flow-step` / `flow-wait` | Automation engine steps and delayed waits |
| `domain-verification` | DNS/DKIM verification polling |

Concurrency per queue is configured in `src/server/worker.ts` (e.g. SES webhook concurrency 5).

## Email send pipeline

1. `sendEmail` / campaign batch validates domain ownership, suppressions, templates/variables.
2. Row inserted into `emails` (`QUEUED` / `SCHEDULED` / `SUPPRESSED`).
3. `queueEmail` enqueues region-specific transactional or marketing job.
4. Worker `executeEmail` builds MIME (nodemailer), calls SES v2, stores `sesEmailId`, updates status.
5. Later SNS events advance `latestStatus` and append `email_events`.

Transactional vs marketing split is driven by SES setting `transactionalQuota` and separate queue workers with different concurrency.

## Auth

- **Magic link:** `POST /api/auth/magic-link`; verify endpoint sets signed session cookie. Without `FROM_EMAIL`, link logs to console in dev.
- **OAuth:** GitHub / Google via Arctic when env vars set.
- **Bootstrap:** First signup creates the team; later users need invites (`/join-team`).
- Session resolution in `hooks.server.ts` populates `event.locals`.

## Templates & design system

- **Design system** (per team): `design_md`, binary assets on disk under `data/`, reusable `design_components` (HTML + email-builder document + slots).
- **Templates:** subject/html/content, optional AI `prompt`, `designSnapshot`, structured `template_elements` and composed `template_components`.
- **Email builder:** client-side block tree (`src/lib/email-builder`), compile/render services produce inbox-safe HTML (inline CSS, fluidify helpers, formatting rules shared with AI prompts).
- **AI:** OpenRouter chat for scaffold/generate; optional Pi agent (`@earendil-works/pi-coding-agent`) for richer design edits when enabled.

## Automations (flows)

- Graph stored as JSON on `automation_flows` (nodes/edges; UI uses `@xyflow/svelte`).
- Trigger e.g. `contact.created` → enrollment → `flow-step` jobs.
- Nodes include trigger, wait, send email, end; waits re-enter via `flow-wait` at `waitUntil`.

## Observability & ops

- `/api/health` for liveness.
- Worker heartbeat + control channel in `app_settings` (`worker:control`).
- Optional Discord webhook env for notifications.
- Optional `EMAIL_CLEANUP_DAYS` for retention.

## Testing

Vitest covers services and many `+server.ts` handlers under co-located `*.test.ts` / `server.test.ts`, with helpers for DB factories and mocked AWS.
