# justSend — Agent Instructions

## Models

- **Do NOT use Claude Opus** (including `claude-opus-4-8-*`) for Task/subagents.
- Prefer **Composer** (`composer-2.5-fast`) for any subagents.
- Prefer doing work in the main agent when practical instead of spinning up Opus.

## Stack decisions

- SvelteKit + Drizzle + SQLite (WAL). No Redis/BullMQ.
- Public REST API and dashboard both use **native SvelteKit** (`+server.ts`, `+page.server.ts`). **Do not use Hono.**
- Self-host only; no Stripe/billing/cloud branching.
- Single app; no monorepo of marketing/SMTP/docs/SDK packages.
- Form actions belong on `+page.server.ts` only (not layouts).
