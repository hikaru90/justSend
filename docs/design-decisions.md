# Design decisions

These choices are encoded in `AGENTS.md`, the schema, and the deployment scripts. Prefer preserving them unless product direction changes.

## Product

### Self-host only

No Stripe, plans, or cloud vs self-host branching. One binary/image, operator-owned AWS credentials and data volume.

### Single application

Not a monorepo of marketing site / SMTP relay / docs / SDK packages. Dashboard, public REST API, and workers share one codebase and one SQLite file.

### Greenfield SvelteKit, not a port

Owlery reimplements the domain on SvelteKit + SQLite. Do not import a Next.js / Prisma / Redis / Hono / tRPC runtime.

## Platform

### SvelteKit for everything HTTP

Public REST and dashboard both use native SvelteKit (`+server.ts`, `+page.server.ts`). **Do not introduce Hono** (or a parallel API framework).

### Form actions only on pages

Mutations belong on `+page.server.ts`, not layouts — keeps action URLs and ownership clear.

### Node 22 + adapter-node

Production is a long-running Node server (not serverless). Fits SQLite, workers, and Docker supervisor.

## Data & async work

### SQLite + WAL instead of Postgres/Redis

- One file under `./data` simplifies backup, Docker volumes, and single-node deploys.
- WAL + busy timeout support concurrent web + worker access.
- Trade-off: horizontal scale-out of writers is limited; design assumes one primary app instance (optional extra worker sharing the same DB volume).

### SQLite job queue instead of Redis/BullMQ

Jobs are rows with claim locks, delays, and retries. Pros: no extra infrastructure, transactional with domain data, idempotent `jobId`s. Cons: poll latency, careful lock recovery, not ideal for huge multi-node fleets.

### Separate web and worker processes

Keeps HTTP responsive while campaigns/SES/webhooks run. Supervisor + dashboard control allow pause/stop/restart without redeploying the web UI.

## Email & AWS

### SES as the only production transporter

Reputation, DKIM, and cost stay with the operator’s AWS account. Owlery configures regions, SNS topics, and configuration sets via admin SES settings; validates callback reachability to `HOST_URL`.

### Transactional vs marketing queues per region

Separate queues and concurrency from `transactionalQuota` / `sesEmailRateLimit` so marketing bursts do not starve transactional send.

### Nodemailer for MIME, SES API for send

Build RFC-compliant messages locally; submit via SES v2 SDK (supports attachments, raw message).

### SNS → enqueue → parse

Callback handler stays thin; heavy parsing and side effects run in the worker for reliability and retries.

## Auth & tenancy

### Team + domain context

Teams own billing-like limits (`dailyEmailLimit`, `apiRateLimit`). Domains are the sending identity (DKIM/SPF/DMARC status) and the UI “project” switcher.

### API keys scoped to team (and optionally domain)

Bearer keys with hashed storage, partial token display, and `FULL` vs `SENDING` permissions.

### First user bootstraps; invites thereafter

Avoids open multi-tenant signup on a private instance while still supporting collaborators.

## Content & AI

### Design system as first-class data

Brand markdown, assets, and reusable components feed both the visual builder and AI prompts — templates stay on-brand without one-off HTML only.

### Inbox-oriented HTML rules

`email-formatting-rules.md` (and runtime twin) capture constraints (inline CSS, spacers, CTA patterns) shared by humans and models.

### AI optional

OpenRouter / Pi require keys; core send/campaign/contact paths work without them.

## Explicit non-goals (current build)

| Non-goal | Notes |
|----------|--------|
| Built-in SMTP relay | Dev-settings SMTP page states it is not included in this self-hosted build |
| Inbound email | Not implemented |
| Multi-region active-active DB | Single SQLite file |
| Billing / usage metering for SaaS | Team daily limits are ops knobs, not Stripe |
| Redis, BullMQ, Hono, Prisma | Rejected in favor of SQLite + SvelteKit |

## UI / UX conventions

- Svelte 5 runes enabled for first-party components.
- Tailwind 4 + light shared primitives (`Button`, `Card`, `Modal`, …).
- Flow editor uses xyflow; email builder is custom block/tree UI.
- Dark mode via `mode-watcher`.
