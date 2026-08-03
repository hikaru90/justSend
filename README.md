# Owlery

Self-hosted email infrastructure for transactional and marketing email via Amazon SES. Built with SvelteKit, Drizzle ORM, and SQLite.

## Requirements

- Node.js 22+
- pnpm
- AWS account with SES configured
- Public URL reachable by AWS SNS (for delivery webhooks)

## Quick start (development)

```sh
pnpm install
cp .env.example .env
# Edit .env — set AUTH_SECRET, HOST_URL, AWS credentials, ADMIN_EMAIL

pnpm db:migrate
pnpm dev:all
```

Open [http://localhost:5173](http://localhost:5173). The first user to sign up creates the team. Additional users need a team invite.

### Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | SvelteKit dev server only |
| `pnpm dev:worker` | Background queue worker only |
| `pnpm dev:all` | App + worker concurrently |
| `pnpm worker` | Run worker (dev / local via tsx) |
| `pnpm worker:prod` | Run compiled worker (`build/worker.js`) |
| `pnpm db:migrate` | Apply SQLite migrations |
| `pnpm build` | Production build (adapter-node + worker bundle) |
| `pnpm start` | Run production supervisor (web + worker) |
| `pnpm start:web` | Run web server only |
| `pnpm test` | Run Vitest suite |
| `pnpm check` | Typecheck with svelte-check |

## Authentication

- **Magic link** — POST `/api/auth/magic-link` with `{ email }`. In dev without `FROM_EMAIL`, the link is printed to the console.
- **GitHub / Google OAuth** — set `GITHUB_*` or `GOOGLE_*` env vars.
- First registered user bootstraps the team; others require a team invite.

## SES setup

1. Sign in as admin (`ADMIN_EMAIL` must match your account email).
2. Go to **Admin → SES Settings** and add a region. Owlery validates that `{HOST_URL}/api/ses_callback` is reachable.
3. Add and verify sending domains under **Domains**.
4. Create API keys under **Dev Settings → API Keys** for programmatic sending.

## Docker

```sh
cp .env.example .env
# Set HOST_URL to your public URL (e.g. https://send.example.com)

docker compose up --build
```

The container runs a supervisor that keeps both the web app and queue worker alive.
Admins can pause / stop / restart the worker from **Queue** in the dashboard.

Production `vite build` is memory-heavy (client + SSR). On a 2–4GB Coolify/VPS host, add a few GB of swap (or raise free RAM) before deploying; otherwise the kernel OOM-kills the build with exit **255** and truncated logs. The image defaults to `NODE_OPTIONS=--max-old-space-size=2048` (override with build-arg `NODE_MAX_OLD_SPACE_SIZE` on larger builders).

## API

REST API lives at `/api/v1/*`. Authenticate with `Authorization: Bearer us_...` API keys created in the dashboard.

## Environment variables

See `.env.example` for the full list. Key variables:

- `DATABASE_URL` — SQLite path (default `file:./data/owlery.db`)
- `HOST_URL` — Public app URL (OAuth callbacks, unsubscribe links)
- `AUTH_SECRET` — Session signing secret (min 16 chars)
- `ADMIN_EMAIL` — Email that receives admin UI access
- `FROM_EMAIL` — Sender for magic-link emails (optional)
- `AWS_*` — Credentials and region for SES/SNS
