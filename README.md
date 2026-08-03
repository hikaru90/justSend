# Owlery

Self-hosted email infrastructure for transactional and marketing email via Amazon SES. Built with SvelteKit, Drizzle ORM, and SQLite.

[![CI](https://github.com/hikaru90/owlery/actions/workflows/ci.yml/badge.svg)](https://github.com/hikaru90/owlery/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Docker](https://img.shields.io/badge/ghcr.io-owlery-blue)](https://github.com/hikaru90/owlery/pkgs/container/owlery)

## Features

- **Transactional email** — REST API send/batch/schedule with templates, attachments, and idempotency keys
- **Marketing campaigns** — contact books, scheduled/batched sends, open/click tracking
- **Domains & SES** — DKIM/SPF/DMARC helpers, multi-region SES settings, SNS delivery webhooks
- **Visual email builder** — block editor, design system, AI-assisted generation
- **Automations** — visual flows (trigger → wait → send)
- **Self-hosted** — single Docker image (web + worker), SQLite, no Redis required

## Quick start (Docker)

```sh
cp .env.example .env
# Set AUTH_SECRET, HOST_URL (public URL), AWS credentials, ADMIN_EMAIL

docker compose up -d
```

Pull a prebuilt image (after the first release tag):

```sh
docker pull ghcr.io/hikaru90/owlery:latest
```

Or build from source with Compose (`build: .` is the default in [`docker-compose.yml`](./docker-compose.yml)).

Open your `HOST_URL`. The first user to sign up creates the team. Additional users need a team invite.

The container runs a supervisor that keeps both the web app and queue worker alive. Admins can pause / stop / restart the worker from **Queue** in the dashboard. Persist data with the `owlery-data` volume mounted at `/app/data`.

See [docs/deployment.md](./docs/deployment.md) for SES/SNS setup, reverse proxies, backups, and upgrades.

## Quick start (development)

```sh
npm install
cp .env.example .env
# Edit .env — set AUTH_SECRET, HOST_URL, AWS credentials, ADMIN_EMAIL

npm run db:migrate
npm run db:seed   # optional — seeds a local example domain after first signup
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173).

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | SvelteKit dev server only |
| `npm run dev:worker` | Background queue worker only |
| `npm run dev:all` | App + worker concurrently |
| `npm run worker` | Run worker (dev / local via tsx) |
| `npm run worker:prod` | Run compiled worker (`build/worker.js`) |
| `npm run db:migrate` | Apply SQLite migrations |
| `npm run db:seed` | Dev seed helpers |
| `npm run build` | Production build (adapter-node + worker bundle) |
| `npm run start` | Run production supervisor (web + worker) |
| `npm run start:web` | Run web server only |
| `npm test` | Run Vitest suite |
| `npm run check` | Typecheck with svelte-check |
| `npm run lint` / `npm run format` | Prettier check / write |

## Authentication

- **Magic link** — POST `/api/auth/magic-link` with `{ email }`. In dev without `FROM_EMAIL`, the link is printed to the console.
- **GitHub / Google OAuth** — set `GITHUB_*` or `GOOGLE_*` env vars.
- First registered user bootstraps the team; others require a team invite.

## SES setup

1. Sign in as admin (`ADMIN_EMAIL` must match your account email).
2. Go to **Admin → SES Settings** and add a region. Owlery validates that `{HOST_URL}/api/ses_callback` is reachable.
3. Add and verify sending domains under **Domains**.
4. Create API keys under **Dev Settings → API Keys** for programmatic sending.

Full walkthrough: [docs/deployment.md](./docs/deployment.md).

## API

REST API lives at `/api/v1/*`. Authenticate with `Authorization: Bearer us_...` API keys created in the dashboard.

See [docs/api.md](./docs/api.md) for curl examples (send, batch, contacts, campaigns).

## Documentation

| Doc | Contents |
|-----|----------|
| [Overview](./docs/overview.md) | What Owlery is and how to run it |
| [Architecture](./docs/architecture.md) | Processes, data model, queue |
| [Deployment](./docs/deployment.md) | SES/SNS, reverse proxy, backups |
| [API](./docs/api.md) | `/api/v1` reference |
| [Contributing](./CONTRIBUTING.md) | Dev setup and PR checklist |
| [Security](./SECURITY.md) | Vulnerability reporting |
| [Changelog](./CHANGELOG.md) | Release notes |

## Environment variables

See `.env.example` for the full list. Key variables:

- `DATABASE_URL` — SQLite path (default `file:./data/owlery.db`)
- `HOST_URL` — Public app URL (OAuth callbacks, unsubscribe links)
- `AUTH_SECRET` — Session signing secret (min 16 chars)
- `ADMIN_EMAIL` — Email that receives admin UI access
- `FROM_EMAIL` — Sender for magic-link emails (optional)
- `AWS_*` — Credentials and region for SES/SNS

## License

[MIT](./LICENSE) © 2026 Alexander Buckner
