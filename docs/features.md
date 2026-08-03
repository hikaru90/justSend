# Features

Capability map of the current Owlery app (dashboard + API + worker).

## Authentication & access

- Magic-link login (console fallback when `FROM_EMAIL` unset)
- Optional GitHub and Google OAuth
- Session cookies; logout API
- Team creation, invites, join-team flow
- Roles: `ADMIN` | `MEMBER` on team membership
- Instance admin UI when user email matches `ADMIN_EMAIL`
- Team switcher and domain (project) switcher in sidebar

## Domains & SES

- Add sending domains; track verification status (`NOT_STARTED` → `SUCCESS` / failures)
- DKIM selector (default `owlery`), SPF/DMARC helpers, region selection
- Open/click tracking toggles (SES configuration sets)
- Background domain verification jobs
- Admin **SES Settings**: regions, SNS topics, callback URL validation, transactional quota %, send rate limit
- Dev seed domain helper for local development

## Transactional email

- Send via REST (`POST /api/v1/emails`) or internal services
- Batch send endpoint
- Schedule send (`scheduledAt`)
- Templates + `{{variable}}` substitution
- Attachments, custom headers, reply-to / cc / bcc
- Cancel queued/scheduled messages
- Idempotency keys
- Status timeline: queued → sent → delivered / bounced / complained / opened / clicked / …
- Suppression short-circuit (`SUPPRESSED`) without hitting SES
- Email detail views in dashboard (“Queue”)

## Marketing campaigns

- Campaign CRUD with HTML/content, subject, preview text
- Bind to contact book and domain
- Schedule, pause, resume
- Batched sending (`batchSize`, `batchWindowMinutes`, cursor)
- Aggregate counters: sent, delivered, opened, clicked, bounced, complained, unsubscribed
- Campaign ↔ contact email join table for dedupe tracking

## Contacts & compliance

- Contact books with custom variables/properties and emoji labels
- Contact CRUD; bulk add (queued)
- Subscribe / unsubscribe public pages
- One-click unsubscribe API
- Double opt-in (configurable from/subject/content per book)
- Unsubscribe reasons: bounced, complained, unsubscribed
- Suppression list (hard bounce, complaint, manual) with team/domain scope

## Automations (flows)

- Visual flow editor (xyflow nodes: trigger, wait, send email, end)
- Status: draft / active / paused
- Trigger type (e.g. contact created) + config JSON
- Enrollments with current node and wait-until
- Execution log events (entered, email queued, wait scheduled, completed, error)

## Templates & design

- Template library per team/domain
- Visual **email builder** (blocks, inspector, component library)
- Template elements (logo, text, button, CTA, link, image, component) with config
- Template components linked to design-system library or custom HTML
- Design system: markdown brand guide, uploaded assets (font/image/logo), reusable components with slots/documents
- Infer / reapply design endpoints; Pi-assisted edit endpoint
- AI template generation via OpenRouter (prompt + formatting rules + design context)
- Export / scaffold template routes
- HTML fluidify and URL absolutization for assets

## Webhooks (outbound)

- Register URLs with secrets, event type filters, domain filters
- Status: active / paused / auto-disabled (after consecutive failures)
- Delivery attempts with retries, response capture, discard path
- Driven by email lifecycle events from SES parsing

## Analytics & limits

- Dashboard overview metrics
- API: email time series, reputation metrics
- Daily usage by team/domain/type (transactional vs marketing)
- Cumulated delivered / hard-bounce / complaint metrics
- Team daily email limit and API rate limits
- Global env rate limits for API and auth email

## Developer settings

- API key create/list/revoke (`us_…` style tokens, hashed at rest)
- SMTP page documents absence of built-in relay (SES-oriented)

## Admin

- SES region configuration and callback health
- Teams management
- Database download; parts export/import for content migration
- Worker pause / stop / restart via supervisor control channel

## Public / misc routes

- Landing redirect/home
- Health check
- Design asset serving (`/api/design-asset/[id]`)
- HTML conversion helper (`/api/to-html`)

## REST API surface (v1)

| Area | Endpoints (representative) |
|------|----------------------------|
| Emails | `GET/POST /emails`, `POST /emails/batch`, `GET/POST …/cancel` |
| Domains | `GET/POST /domains`, verify |
| Contact books | CRUD + nested contacts + bulk |
| Campaigns | CRUD + schedule / pause / resume |
| Analytics | email time series, reputation metrics |

Authenticate with `Authorization: Bearer <api key>`.

## Deployment features

- Docker multi-stage build; Compose with persistent `owlery-data` volume
- Supervisor runs web + worker in one container by default
- Optional dedicated worker service (commented in Compose) if web is `start:web` only
- Nixpacks config for PaaS-style deploys
- Vitest suite with coverage script

## Not included (yet)

- **Inbox QA** — Litmus-style client previews, spam scoring, link checker ([implementation plan](./implementation-plan.md#inbox-qa))
- Inbound email receiving
- First-class SMTP submission server
- Multi-node SQLite clustering / managed Postgres mode
- SaaS billing
