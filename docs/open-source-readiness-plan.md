# Open-source readiness plan

**Status:** direction approved 2026-08-03 — ready to execute.
**Goal:** take Owlery from a personal project to a public open-source repository that external people can install, run, and contribute to.

## Locked decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| License | **MIT** | Same as useSend (which Owlery evolved from); maximum adoption |
| Git history | **Fresh `owlery` repo** with one clean initial commit | Current history contains a committed dev DB with session tokens; fresh start beats `git filter-repo` and fixes the `justSend` → `owlery` rename in one move |
| Old repo | Rename/archive `hikaru90/justSend` on GitHub | Manual owner action |
| API key prefix | Keep `us_…` | Backwards compatible, harmless |
| DB file name | Canonical `owlery.db` everywhere | `.env.example`, compose, and supervisor already default to it |

## Current-state audit (evidence from 2026-08-03)

### Privacy / security

- 🔴 `data/justsend.db` (548 KB) **is committed to git** and deliberately un-ignored (`.gitignore` contains `!/data/justsend.db` and `!/data/design/`). Contents: **4 rows in `sessions` (live session tokens)**, 1 `users` row, 4 `emails` rows, `worker:heartbeat` runtime state in `app_settings`. `data/design/1/image/02c1587c6e2245bebe34c720-bg1.png` is also tracked.
- 🟢 `.env` was never committed (`git log -- .env` is empty); no `AKIA…` keys in tracked files. Local `.env` holds real AWS/GitHub/OpenRouter secrets — must stay untracked.
- 🟠 Tracked junk: `.DS_Store`, `package.json.tmp` (entire content: `# will rewrite package.json properly`), `opencode.json` (listed in `.gitignore` yet still tracked), empty `patches/` directory.
- 🟠 Untracked but should be committed: `docs/`. Untracked and should stay out: `data/`, `useSend-legacy/`.

### Identity / naming

- GitHub repo is `hikaru90/justSend`; package name is `owlery`; dev DB is `justsend.db`; runtime default DB is `owlery.db`; leftover local `usesend.db*`; API keys are prefixed `us_`; DKIM selector is `owlery`.

### Engineering

- Tests: 368 across 60 files, **2 failing** — `src/lib/server/service/email-service.test.ts` cursor pagination (~line 193). Working tree also has 4 modified files (`extractTokens.ts(+test)`, `EmailBuilder.svelte`, `editor-state.svelte.ts`).
- **No versioned migrations:** `src/lib/server/db/migrate.ts` is a hand-written idempotent `CREATE TABLE IF NOT EXISTS` blob; `drizzle.config.ts` points `out: './drizzle'` but that directory is empty → operators have no upgrade path between releases.
- No lint/format tooling (no ESLint/Prettier/Biome); `svelte-check` exists but nothing enforces it — there is no `.github/` and no CI at all.
- Svelte config is embedded in `vite.config.ts` via `sveltekit({ … })` plugin options instead of a conventional `svelte.config.js` — works, but unusual; document for contributors.
- Missing community files: `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`; `package.json` is `private`, `0.0.1`, with no repository/license metadata.
- Root clutter: `email-example.html` (66 KB) and `email-formatting-rules.md` (kept in sync with `src/lib/server/email-formatting-rules.ts`; the comment there references the repo root).
- Docker: solid multi-stage build + supervisor (web+worker) + compose volume, but no `HEALTHCHECK` and no published image (users must build from source). `scripts/pull-db.mjs` pulls a *production* DB — maintainer-only, undocumented.

---

## Phase 0 — Fresh start & privacy 🔒

- [ ] **0.1** `.gitignore`: remove the `!/data/justsend.db` and `!/data/design/` exceptions so all of `data/` stays local.
- [ ] **0.2** `git rm -r --cached data/` (DB + design assets); delete local `justsend.db*` and `usesend.db*` leftovers (after backup if the dev data matters).
- [ ] **0.3** Rotate local `AUTH_SECRET` — sessions were committed, so treat old signing secrets as compromised.
- [ ] **0.4** *(Owner, on github.com)* create the new `owlery` repo; push the cleaned tree as the initial commit; rename/archive `hikaru90/justSend`.
- [ ] **0.5** Run `gitleaks detect` on the new repo as a final secret scan.

## Phase 1 — Green baseline & repo hygiene

- [ ] **1.1** Fix the 2 failing cursor-pagination tests in `src/lib/server/service/email-service.test.ts`.
- [ ] **1.2** Commit or stash the 4 WIP files (design token extraction + email builder) — `main` must be green.
- [ ] **1.3** Commit `docs/` (currently untracked).
- [ ] **1.4** Untrack `.DS_Store`, `opencode.json`; delete `package.json.tmp` and the empty `patches/` dir.
- [ ] **1.5** Move `email-example.html` → `docs/examples/email-example.html` and `email-formatting-rules.md` → `docs/email-formatting-rules.md`; update the "keep in sync" comment in `src/lib/server/email-formatting-rules.ts`.
- [ ] **1.6** `package.json`: `version: 0.1.0`; add `description`, `repository`, `homepage`, `bugs`, `license: "MIT"`, `keywords`; remove the duplicate `dev:app` script (identical to `dev`).
- [ ] **1.7** Sweep for `justsend`/`usesend` references (DB names, comments, docs); canonical `owlery.db`.

## Phase 2 — Community files

- [ ] **2.1** `LICENSE` — MIT, © 2026 Alexander Buckner.
- [ ] **2.2** `CONTRIBUTING.md` — dev setup, scripts table, pointer to `docs/architecture.md`, testing conventions (co-located `*.test.ts`, DB factories in `src/tests/helpers`, mocked AWS), the `AGENTS.md` rules that apply to humans (form actions on `+page.server.ts` only, native SvelteKit endpoints, no Hono), PR checklist.
- [ ] **2.3** `SECURITY.md` — report privately via GitHub Security Advisories; note the sensitive surface (AWS credentials, email content, contact PII).
- [ ] **2.4** `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1.
- [ ] **2.5** `CHANGELOG.md` — Keep a Changelog format; seed with `## [0.1.0]` as the first public release.
- [ ] **2.6** README facelift — badges (CI, license, Docker image), dashboard/email-builder screenshot or GIF, feature highlights up top, Docker-first quickstart for *users* (dev setup second), links to docs/roadmap, license section.

## Phase 3 — CI/CD & automation

- [ ] **3.1** `.github/workflows/ci.yml` — Node 22, pnpm cache; run `pnpm check` → `pnpm test` → `pnpm build` on PRs and pushes to `main`.
- [ ] **3.2** `.github/workflows/docker.yml` — build & push `ghcr.io/<owner>/owlery:<tag>` + `:latest` on version tags; document the prebuilt image in compose (biggest single usability win: users stop building from source).
- [ ] **3.3** `.github/dependabot.yml` — npm, docker, github-actions ecosystems; weekly, grouped PRs.
- [ ] **3.4** Issue templates (bug report with version/env/SES-region fields; feature request) + PR template (tests / check / docs checklist).

## Phase 4 — Engineering robustness for external operators

- [ ] **4.1** ⭐ **Versioned database migrations** — the most important technical item. `drizzle-kit generate` from `schema.ts`; commit SQL under `drizzle/`; replace the boot-time `migrate()` blob with Drizzle's migrator; baseline `0000` must match the current schema so existing installs upgrade cleanly; keep the `pnpm db:migrate` UX. Without this, every release risks operator data loss.
- [ ] **4.2** Prettier + `prettier-plugin-svelte` + `prettier-plugin-tailwindcss` (tabs, matching current style); add `pnpm lint` / `pnpm format`; one-time format pass in its own commit; enforce in CI.
- [ ] **4.3** Dockerfile `HEALTHCHECK` against `/api/health`; document the `/app/data` volume and backup story.
- [ ] **4.4** Wire the existing `dev-seed.ts` as `pnpm db:seed` so new contributors get a populated UI without AWS.
- [ ] **4.5** *(Optional)* `SES_DRY_RUN=1` mode — simulate SES sends + SNS events locally so people can try Owlery without an AWS account.
- [ ] **4.6** Verify `src/lib/server/env.ts` fails fast with clear zod errors at boot; align `.env.example` comments with it.

## Phase 5 — Docs for users (not just developers)

- [ ] **5.1** `docs/deployment.md` — end-to-end: SES/SNS setup walkthrough (region, configuration sets, topics, `/api/ses_callback`), reverse proxy (Caddy/Traefik), Coolify/Nixpacks note, backups (leverage the existing online-backup path), upgrades (`docker pull` + auto-migrations).
- [ ] **5.2** `docs/api.md` — `/api/v1` reference extracted from `features.md` plus curl examples (send, batch, contacts, campaigns). OpenAPI spec is a later stretch goal.
- [ ] **5.3** `scripts/README.md` — mark `pull-db.mjs` as maintainer-only (pulls a production DB); document `export-parts` / `import-parts`.
- [ ] **5.4** Keep `docs/README.md` index current as docs are added.

## Phase 6 — Launch

- [ ] **6.1** Tag `v0.1.0`; create a GitHub Release with changelog notes + Docker image link.
- [ ] **6.2** Flip the repo public; pin a Roadmap issue; enable Discussions.
- [ ] **6.3** Seed `good first issue` labels — the Inbox QA link-checker from [implementation-plan.md](./implementation-plan.md#inbox-qa) is a great first candidate.
- [ ] **6.4** *(Optional)* Announce: Show HN, r/selfhosted, awesome-selfhosted PR.

---

## Execution order & effort

- Sequence: **Phase 0 → 1 → 2/3 (parallelizable) → 4 → 5 → 6**.
- Phases 0–3 ≈ 1 day of mostly mechanical work. **4.1 (migrations)** ≈ ½ day and is the only deep technical task.
- The repo is **safe to publish after Phase 3** and **pleasant to use after Phase 5**.
- Owner-only actions on github.com: create the fresh repo + archive `justSend` (0.4), flip public (6.2). Everything else is local/PR work.


