# Owlery — Overview

**Owlery** is a self-hosted email platform: send transactional and marketing mail through **Amazon SES**, manage contacts and campaigns, build templates (including AI-assisted design), and expose a REST API — all from one SvelteKit app.

It is a single app on a deliberately simple stack: SvelteKit, SQLite, and Amazon SES — no Redis, billing, or cloud/self-host split.

## What it does

1. **Send mail** — API or dashboard → SQLite-backed job queue → SES (per-region transactional vs marketing queues).
2. **Track delivery** — SNS callbacks update email status (delivered, opened, clicked, bounced, complained, etc.) and fan out outbound webhooks.
3. **Market** — Contact books, campaigns (batched/scheduled), suppression lists, double opt-in, unsubscribe flows.
4. **Automate** — Visual automation flows (trigger → wait → send email → end) with enrollment and execution logs.
5. **Design** — Team design system (markdown + assets + components), visual email builder, OpenRouter/Pi-assisted generation and editing.

## Who it is for

Operators who want **SES economics** with a full product UI and API, without SaaS billing or a multi-service Redis/Postgres stack. Single deployment (Docker or Node), local SQLite data directory.

## Stack at a glance

| Layer | Choice |
|-------|--------|
| App framework | SvelteKit 2 + Svelte 5 (runes), adapter-node |
| UI | Tailwind CSS 4, bits-ui, Lucide, mode-watcher |
| ORM / DB | Drizzle + better-sqlite3 (WAL) |
| Queue | Custom SQLite `queue_jobs` poller (no Redis/BullMQ) |
| Auth | Magic link + optional GitHub/Google (Arctic); session cookies |
| Email transport | AWS SES v2 (+ SNS for events); nodemailer for MIME assembly |
| AI (optional) | OpenRouter + Pi coding-agent SDK for templates/design |
| Deploy | Docker Compose + supervisor (web + worker), Nixpacks-friendly |

## Runtime model

```
┌─────────────────────┐     ┌──────────────────────┐
│  SvelteKit web      │     │  Worker process      │
│  Dashboard + REST   │────▶│  Queue pollers       │
│  Auth, SES callback │ SQLite │  SES send, campaigns│
└─────────────────────┘     │  SNS parse, webhooks │
                            │  Flows, domain verify│
                            └──────────┬───────────┘
                                       │
                                       ▼
                                 Amazon SES / SNS
```

Production entrypoint `npm run start` runs `scripts/supervisor.mjs`, which keeps **web** (`build/index.js`) and **worker** (`build/worker.js`) alive. Admins can pause/stop/restart the worker from the dashboard via `app_settings`.

## Quick start

See the root [README](../README.md): `npm install` → configure `.env` → `npm run db:migrate` → `npm run dev:all`.

Requirements: Node 22+, npm, AWS SES, and a public `HOST_URL` reachable by SNS for delivery webhooks.
