# Contributing to Owlery

Thank you for your interest in contributing! This document covers local development, project conventions, and what we expect in pull requests.

## Development setup

```sh
pnpm install
cp .env.example .env
# Edit .env — set AUTH_SECRET, HOST_URL, AWS credentials, ADMIN_EMAIL

pnpm db:migrate
pnpm db:seed
pnpm dev:all
```

Open [http://localhost:5173](http://localhost:5173). The first user to sign up creates the team.

## Scripts

See the [README](README.md#scripts) for the full scripts table (`dev`, `dev:all`, `db:migrate`, `test`, `check`, etc.).

## Architecture

For a deeper overview of how the app is structured, see [docs/architecture.md](docs/architecture.md).

## Testing

- Tests are co-located as `*.test.ts` next to the code they cover.
- Database test helpers and factories live in `src/tests/helpers`.
- AWS SDK clients are mocked in tests — do not call real AWS from the test suite.

Run the suite with:

```sh
pnpm test
```

## Project conventions

These rules apply to all contributions (human and agent-assisted):

- **Stack:** SvelteKit + Drizzle ORM + SQLite (WAL). No Redis/BullMQ.
- **Endpoints:** Use native SvelteKit (`+server.ts`, `+page.server.ts`). Do **not** use Hono.
- **Form actions:** Belong on `+page.server.ts` only — not on layouts.
- **Deployment model:** Self-host only. No Stripe/billing or cloud-SaaS branching.
- **Svelte config:** Embedded in `vite.config.ts` via `sveltekit({ … })`. There is no separate `svelte.config.js`.

See also [AGENTS.md](AGENTS.md) for additional agent-oriented guidance.

## Pull request checklist

Before requesting review, confirm:

- [ ] Tests added or updated for behavior changes
- [ ] `pnpm check` passes
- [ ] `pnpm test` passes
- [ ] Docs updated if the change affects setup, API, or architecture

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## Security

If you discover a security vulnerability, please follow [SECURITY.md](SECURITY.md) — do **not** open a public issue.
