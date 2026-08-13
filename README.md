# Owlery

Self-hosted email infrastructure for transactional and marketing email via Amazon SES. Built with SvelteKit, Drizzle ORM, and SQLite.

[![CI](https://github.com/hikaru90/owlery/actions/workflows/ci.yml/badge.svg)](https://github.com/hikaru90/owlery/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Docker](https://img.shields.io/badge/ghcr.io-owlery-blue)](https://github.com/hikaru90/owlery/pkgs/container/owlery)

## Features

- **Amazon SES** — Multi-region SES configuration from the dashboard. Creates SNS topics, subscribes your callback URL, and registers SES configuration sets for open/click tracking. DKIM selector (default `owlery`), SPF/DMARC helpers, and background domain verification jobs. Transactional quota and send rate limit per region.

- **Transactional email** — REST API send/batch/schedule with templates, attachments, custom headers, reply-to/cc/bcc, and idempotency keys. Cancel queued messages. Status timeline: queued → sent → delivered / bounced / complained / opened / clicked. Suppression short-circuit without hitting SES.

- **Marketing campaigns** — Campaign CRUD with HTML/content, subject, and preview text. Bind to contact books and domains. Schedule, pause, resume. Batched sending with configurable batch size and window. Aggregate counters (sent, delivered, opened, clicked, bounced, complained, unsubscribed). Dedupe tracking via campaign-contact join table.

- **Contacts & compliance** — Contact books with custom variables/properties and emoji labels. Bulk add (queued), subscribe/unsubscribe public pages, one-click unsubscribe API, double opt-in with configurable from/subject/content per book. Suppression list (hard bounce, complaint, manual) with team/domain scope.

- **Visual flow automations** — Visual flow editor using [xyflow](https://xyflow.com) nodes: trigger → wait → send email → end. Statuses: draft / active / paused. Trigger types (e.g. contact created) with config JSON. Enrollments track current node and wait-until. Execution log events (entered, email queued, wait scheduled, completed, error). Flows process in the background queue worker.

- **Templates & visual email builder** — Template library per team/domain. Block-based visual email builder with inspector and component library. Template elements: logo, text, button, CTA, link, image, component. Templates store content as **OwlDoc** JSON (deterministic fixed-point format) which is transpiled through MJML → HTML with URL absolutization and fluidify passes. `{{variable}}` substitution, prompt-based AI generation via OpenRouter.

- **Automatic design system** — AI-powered design system management. Point Owlery at a website URL and it will:
  - Fetch the page, strip noise, and call OpenRouter to infer a **design.md** (brand voice, colors, typography, spacing, buttons, links, logo usage, email-friendly layout notes)
  - Download the logo and web fonts automatically
  - Save everything as a reusable design system per team
  - **Reapply** the design system to existing library components via AI to restyle their block-tree document while preserving structure and slot pointers
  - **Pi-assisted editing**: an AI coding agent can edit templates and components directly

- **MCP (Model Context Protocol)** — Expose templates and flows to AI agents via a standard MCP server (HTTP or stdio). Tools: `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template`, `compile_template_preview`, `list_flows`, `get_flow`, `create_flow`, `update_flow`, `delete_flow`, `describe_owl_doc`. Authenticated with the same API keys as the REST API.

- **Teams & access** — First registered user bootstraps the team; additional users join via invite. Roles: `ADMIN` | `MEMBER`. Team switcher and domain (project) switcher in the sidebar. Instance admin UI when user email matches `ADMIN_EMAIL`.

- **Webhooks (outbound)** — Register URLs with secrets, event type filters, and domain filters. Status: active / paused / auto-disabled after consecutive failures. Delivery attempts with retries, response capture, and discard path. Driven by email lifecycle events from SES SNS parsing.

- **Analytics & limits** — Dashboard overview metrics, API email time series and reputation metrics. Daily usage by team/domain/type (transactional vs marketing). Team daily email limit and API rate limits.

- **Developer settings** — API key create/list/revoke (`us_…` style tokens, hashed at rest). SMTP setup guidance page.

- **Self-hosted** — Single Docker image (web + worker via supervisor), SQLite (WAL), no Redis required. Compose with persistent volume. Optional dedicated worker service.

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
| `npm run mcp` | Run MCP stdio server (for local AI agents) |
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

## MCP

Owlery ships an MCP server that exposes templates and flows to AI agents:

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  owlery:
    url: "https://<your-owlery-host>/mcp"
    headers:
      Authorization: "Bearer ${OWLERY_API_KEY}"
```

Or for local agents with direct SQLite access:

```bash
npm run mcp
```

See [mcp/README.md](./mcp/README.md) for the full tool reference.

## API

REST API lives at `/api/v1/*`. Authenticate with `Authorization: Bearer us_...` API keys created in the dashboard.

See [docs/api.md](./docs/api.md) for curl examples (send, batch, contacts, campaigns).

## Documentation

| Doc | Contents |
|-----|----------|
| [Overview](./docs/overview.md) | What Owlery is and how to run it |
| [Architecture](./docs/architecture.md) | Processes, data model, queue |
| [Features](./docs/features.md) | Full capability map |
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

## Acknowledgements

Thanks to Abdulrahman Mahmutoglu ([JustSend](https://github.com/AbdAsh/JustSend/), MIT), which Owlery started from.

## License

[MIT](./LICENSE) © 2026 Alexander Bückner.
