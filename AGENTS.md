# Owlery — Agent Instructions

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

## Email pipeline (MJML delivery)

- All user-facing email HTML ships through the **MJML delivery stage (C2)**: studio markup (**C1** = `compileOwlHtml` / `renderOwlMarkupHtml`, deterministic fixed-point, what AI/Pi edits and lints) → `mjml-map`/`to-mjml` → `mjml2html` (`src/lib/email/mjml/transpile.ts`, lazy import, `ssr.external: ['mjml']`) → `finalizeDeliveryHtml` (light-only metas, class="body" + gradient pins, owl-id continuation, light-override).
- C2 consumers: studio preview (sandboxed iframe), Save/Test send, export, API/flow sends, design-system components (preview cards + saved snapshots). Pi/AI never sees C2 — they edit C1 markup or block documents.
- `data-owl-mjml` marks delivered html: absolutize skips the fluidify re-width pass; prompts/catalogs must exclude delivered snapshots (they'd flood context with MSO/VML scaffolding).

## AI / Pi agent UI (required)

When working on AI-assisted email or design-system flows, **always show streamed agent output in the UI**. Do not hide prompts or context behind a spinner-only status line.

Every AI/Pi stream panel must surface:

1. **System prompt** — collapsible block (`type: 'system'` / SSE `stage: 'system'`).
2. **Context** — full user/workspace prompt: design.md summary, assets, catalog, AGENTS.md, etc. (`type: 'context'` / `stage: 'context'`).
3. **Live stream** — thinking deltas, model text deltas, tool start/end, step messages.

Shared implementation:

- `$lib/ai/stream-feed.ts` — event → feed reducer
- `$lib/components/ai/AiStreamFeed.svelte` — feed UI (used by Owl Studio + can replace inline feeds)
- Pi SSE: `PiEditStreamEvent` in `pi-service.ts` (`system`, `context`, `thinking`, `text`, `tool_*`)
- Owl AI SSE: `GenerateProgressEvent` in `ai-owl-service.ts` (`system`, `context`, `delta`)

See `docs/studio-rebuild-plan.md` § AI transparency.

