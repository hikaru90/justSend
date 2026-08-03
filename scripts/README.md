# Scripts

Production and maintenance utilities for Owlery.

## `supervisor.mjs`

Production process supervisor used as the **Docker CMD** and `npm run start`.

Spawns and keeps alive:

- **Web** — `build/index.js` (SvelteKit adapter-node)
- **Worker** — `build/worker.js` (queue poller)

Behavior:

- Restarts either process on unexpected exit
- Polls `app_settings` key `worker:control` every 2 seconds so the admin dashboard can pause, stop, or restart the worker
- Handles `SIGINT` / `SIGTERM` for graceful shutdown

Requires a prior `npm run build` (or Docker image build) so both entry files exist.

## `build-worker.mjs`

Bundles `src/server/worker.ts` into `build/worker.js` using esbuild.

Invoked automatically by:

- `npm run build`
- Dockerfile build stage

The worker bundle is ESM, targets Node 22, and keeps npm packages external (same as the web build).

## `pull-db.mjs`

**MAINTAINER ONLY** — do not run casually.

Downloads a production SQLite snapshot from a remote Owlery instance's admin endpoint into the local `DATABASE_URL` path.

```sh
npm run db:pull -- https://mail.example.com
```

Requires an admin session cookie (`owlery_session`) for the user matching `ADMIN_EMAIL`:

```sh
OWLERY_SESSION='owlery_session=...' npm run db:pull -- https://mail.example.com
# or
npm run db:pull -- https://mail.example.com --cookie 'owlery_session=...'
```

The script fetches `/admin/database/download`, writes to a temp file, removes local `-wal`/`-shm` sidecars, and replaces the target database.

**Warnings:**

- Overwrites your local database — back up first
- Pulls real customer/production data — handle according to your privacy policy
- Session cookies expire; copy a fresh cookie from browser DevTools if auth fails
- Intended for debugging and migration support, not routine operator workflows

Env expectations: `DATABASE_URL` (default `file:./data/owlery.db`), optional `OWLERY_SESSION`. Uses `dotenv/config` for `.env` loading.

## `export-parts.ts` / `import-parts.ts`

Content migration helpers for moving selected database slices between instances without a full DB copy.

Exposed as:

```sh
npm run db:export-parts -- --parts=templates,design --team=1 --out=pack.zip
npm run db:import-parts -- --parts=templates,design --team=1 --file=pack.zip
```

### Parts

| Part | Scope | Contents |
|------|-------|----------|
| `ses` | Global | SES region settings |
| `domains` | Team | Sending domains |
| `templates` | Team | Templates and elements |
| `design` | Team | Design system, assets (DB + on-disk files under `data/design/`), components |

Team-scoped parts require `--team=<id>`.

Export writes a zip pack. Import merges only the listed parts present in the pack; everything else in the target database is left untouched.

The admin UI also exposes parts export/import under **Admin**.

Implementation: [`src/lib/server/service/db-parts-service.ts`](../src/lib/server/service/db-parts-service.ts).
