# Deployment

End-to-end guide for running Owlery in production.

## Requirements

| Requirement | Notes |
|-------------|--------|
| **Docker** (recommended) or Node 22+ | Single container runs web + worker via supervisor |
| **Amazon SES account** | Verified sending domains; IAM credentials with SES + SNS permissions |
| **Public `HOST_URL`** | Must be reachable by AWS SNS over HTTPS for delivery/event webhooks |

Optional but recommended:

- Reverse proxy with TLS (Caddy, Traefik, nginx)
- Persistent volume for `/app/data`
- `ADMIN_EMAIL` set to your operator account

See [`.env.example`](../.env.example) for the full environment variable list.

## Docker Compose quickstart

```sh
cp .env.example .env
# Edit .env: AUTH_SECRET, HOST_URL, AWS_*, ADMIN_EMAIL

docker compose up -d
```

The default [`docker-compose.yml`](../docker-compose.yml) builds from source. After the first release, you can use the prebuilt image instead:

```yaml
services:
  app:
    image: ghcr.io/hikaru90/owlery:latest
    # build: .
```

```sh
docker pull ghcr.io/hikaru90/owlery:latest
docker compose up -d
```

The app listens on **port 3000**. Compose maps `3000:3000` and mounts the `owlery-data` volume at `/app/data`.

## Persistent data (`/app/data`)

Everything that must survive container restarts lives under `/app/data`:

| Path | Contents |
|------|----------|
| `owlery.db` | SQLite database (teams, emails, contacts, queue jobs, …) |
| `owlery.db-wal`, `owlery.db-shm` | WAL journal files (SQLite runs in **WAL mode**) |
| `design/` | Uploaded design-system assets (fonts, images, logos) |
| `pi/` | Pi coding-agent workspace (optional AI features) |

Mount a named or host volume at `/app/data`. Do **not** bake this directory into the image.

### Backups

Owlery uses SQLite **WAL mode** with concurrent web + worker access. For a consistent snapshot, use SQLite's **online backup API** — the same mechanism the admin UI uses:

1. Sign in as the user matching `ADMIN_EMAIL`.
2. Go to **Admin** → **Download full database**.

That route calls `backupDatabaseTo()`, which uses `better-sqlite3`'s `.backup()` and is safe while the app is running.

For scripted backups, stop the container briefly or copy via the admin download endpoint. If you copy raw files while running, prefer the online backup over copying `owlery.db` alone (WAL may not be checkpointed).

Restore by placing the downloaded `.db` file at the path in `DATABASE_URL` (default `file:./data/owlery.db`) and restarting. Remove stale `-wal`/`-shm` sidecar files if present.

For content-only migration (templates, design system, SES settings), use `pnpm db:export-parts` / `pnpm db:import-parts` — see [scripts/README.md](../scripts/README.md).

## SES and SNS setup

Owlery sends mail through **Amazon SES** and receives delivery events via **SNS** HTTP subscriptions.

### 1. Configure AWS credentials

Set in `.env`:

```env
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1
HOST_URL=https://mail.example.com
```

The IAM user/role needs SES send permissions and SNS topic create/subscribe permissions in each region you use.

### 2. Ensure the callback URL is public

SNS must reach:

```
{HOST_URL}/api/ses_callback
```

The endpoint answers `GET` with `{ "data": "Hello" }` for health checks and accepts `POST` for SNS subscription confirmations and SES event notifications.

Configure your reverse proxy to forward `/api/ses_callback` to the container on port 3000.

### 3. Add a region in Admin → SES Settings

1. Sign in as the `ADMIN_EMAIL` user.
2. Open **Admin → SES Settings** → add a region.

Owlery will:

1. Validate that `{HOST_URL}/api/ses_callback` returns HTTP 200.
2. Create an SNS topic (`{prefix}-{region}-unsend`).
3. Subscribe the topic to `{HOST_URL}/api/ses_callback` (HTTPS).
4. Create four SES **configuration sets** for that region:
   - **general** — delivery, bounce, complaint, send, …
   - **click** — general + click tracking
   - **open** — general + open tracking
   - **full** — general + click + open

Configuration set names follow `{idPrefix}-{region}-unsend-{general|click|open|full}`.

In production, incoming SNS messages are rejected unless the `TopicArn` matches a topic registered in Owlery.

### 4. Add and verify domains

Under **Domains**, add each sending domain. Owlery shows DNS records for DKIM/SPF/DMARC. Use **Verify** (or the API) to refresh verification status.

When creating domains via API, open/click tracking toggles select the appropriate configuration set.

### 5. Create API keys

**Dev Settings → API Keys** → create a key (`us_…` token). Use it for programmatic sending — see [api.md](./api.md).

## Reverse proxy

Terminate TLS at the proxy and forward to the container on **port 3000**.

### Caddy

```caddy
mail.example.com {
    reverse_proxy localhost:3000
}
```

Caddy obtains and renews certificates automatically.

### Traefik

Example Docker labels on the Owlery service:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.owlery.rule=Host(`mail.example.com`)
  - traefik.http.routers.owlery.entrypoints=websecure
  - traefik.http.routers.owlery.tls.certresolver=letsencrypt
  - traefik.http.services.owlery.loadbalancer.server.port=3000
```

Ensure `HOST_URL` matches the public HTTPS URL (including scheme, no trailing slash).

## Coolify / Nixpacks

Owlery ships a [`nixpacks.toml`](../nixpacks.toml) for PaaS-style deploys. The production build runs Vite + SvelteKit, which is **memory-heavy**.

Defaults:

- `NODE_OPTIONS=--max-old-space-size=2048` in `nixpacks.toml`
- Dockerfile build arg `NODE_MAX_OLD_SPACE_SIZE=2048`

On small VPS instances (2–4 GB RAM), the OOM killer may terminate the build. Mitigations:

1. Set a lower heap if needed, or raise it on a builder with more RAM:
   ```sh
   docker build --build-arg NODE_MAX_OLD_SPACE_SIZE=3072 .
   ```
2. Add **swap** on the build host (Coolify docs often recommend 2–4 GB swap for Node builds).
3. Prefer the prebuilt `ghcr.io/hikaru90/owlery:latest` image to skip source builds entirely.

Start command: `node scripts/supervisor.mjs` (web + worker).

## Upgrades

```sh
docker pull ghcr.io/hikaru90/owlery:latest
docker compose up -d
```

Or rebuild from source and restart the container.

**Migrations run automatically on boot** — both the web app (`hooks.server.ts`) and worker call `migrate()` at startup. No separate migration step is required in production.

The `/app/data` volume is preserved across upgrades.

## Health check

```
GET /api/health
```

Returns:

```json
{ "status": "ok" }
```

Use this for Docker `HEALTHCHECK`, load balancer probes, and uptime monitoring.

## Key environment variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLite path (default `file:./data/owlery.db`) |
| `HOST_URL` | Public URL — OAuth, unsubscribe links, SNS callback validation |
| `AUTH_SECRET` | Session signing secret |
| `ADMIN_EMAIL` | Grants admin UI access |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` | SES/SNS |
| `FROM_EMAIL` | Magic-link sender (optional; logs to console if unset) |
| `API_RATE_LIMIT`, `AUTH_EMAIL_RATE_LIMIT` | Rate limits |
| `OPENROUTER_API_KEY` | Optional AI template generation |

Full list: [`.env.example`](../.env.example).

## Optional: separate worker

The default image runs web + worker together via `scripts/supervisor.mjs`. To scale workers separately, switch the app to `pnpm start:web` and uncomment the dedicated `worker` service in `docker-compose.yml` (both must share the same `/app/data` volume).
