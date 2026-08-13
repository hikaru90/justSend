# Studio rebuild plan

Rebuild the Owl studio into a genuine AI-assisted email template builder. The editor must compile to accessible HTML emails, let the AI compose whole templates from name/subject/description, and let every generated element's CSS be visible and editable by hand — no more "regenerate-and-pray".

**Status:** Phase A–C implemented. Phase D verified (403 tests pass).

## Why (current pain)

- No per-section previews; you cannot tell what a section looks like before adding it.
- Compile errors/warnings are nearly invisible (a tiny count badge, tooltip only).
- **No CSS editing.** Font size, color, padding, margin, alignment can't be changed except by editing the design system and regenerating.
- AI only fills copy into the existing structure; it cannot build a template from the template's name/subject/description.

## Decisions (already settled, do not reopen)

- **Preview = sandboxed iframe (updated for MJML delivery).** Delivery HTML is MJML-compiled (MSO/VML conditionals, responsive `mj-column-*` classes) and needs its head CSS, so the preview renders the full delivery document in a `sandbox="allow-same-origin"` srcdoc iframe; selection/hover query the iframe document via `data-owl-id`. (Earlier decision was a plain div with body innerHTML — superseded by MJML delivery.)
- **Emails are always light.** The compiler pins `color-scheme: light only` in
  `<head>` and the base CSS, then runs a light-pinning override pass that
  re-asserts every inline light color under `@media (prefers-color-scheme)`
  with `!important`, stamps `data-ogsc`/`data-ogsb` for Outlook, and emits
  `u + .body` Gmail blend-mode CSS plus `gmail-blend-screen` /
  `gmail-blend-difference` wrappers (content inside `class="body"`). It never
  emits `data-owl-dark-*` markup — so previews and inboxes render
  deterministically and can never blacken. The override is re-applied by the
  MJML delivery post-pass (`postprocess.ts`).
- **Right panel = property inspector, not curated presets.** It reads the actual CSS properties from the section HTML as editable rows:
  - colors → swatches, sizes → steppers, enums → dropdowns, everything else → text field
  - add/remove properties
  - attributes rows (`href`, `src`, `alt`, `align`, `bgcolor`, …), add/remove
  - content fields for text / URL / image (slot-driven where slots exist)
  - ancestor breadcrumbs to reach `<td>/<tr>/<table>` containers
  - **raw section HTML is editable** (read/write textarea + Apply) — this is a hard requirement.
- **Single source of truth = `section.html` in the OwlDoc.** Edits write directly into the section fragment. The `doc.styles` overlay idea is dropped.
- Sections get stable `data-owl-id`s minted **client-side** on add/load (browser `DOMParser`, no deps) so clicks map 1:1 to the authored fragment. Editing a token-governed property strips the `data-owl-token` reference (literal wins).
- **AI builds the full template again.** Name + subject + description (carried by `templates.prompt`) → AI picks sections from the library, orders them, fills slot values + preheader. Old scaffold/compose services were deleted in P4, so this is a new flow.
- Keep: deterministic/idempotent compiler, slot system, server save/send paths, `template_elements`/`template_components` tables (db-parts backup/restore), email-builder module for the design-system surface.

## Phases

### A — Preview: kill the black screen, add thumbnails + issues

- `compileOwlDoc` returns per-section `sectionHtml` (the compiled, fluidified fragment of each section root, mapped back to section ids).
- OwlStudio renders preview as a plain div: parse `preview.html`, inject `body.innerHTML` via `{@html}`, apply container-scoped preview CSS (`.owl-preview-root` reset, mobile `owl-stack` stacking via `data-viewport`, click-to-select).
- Left column: each section row gets a scaled thumbnail rendered from `sectionHtml`.
- Issues: visible count + clickable list; clicking an issue selects the section/element when the issue carries an `owlId`.

### B — Property inspector + editable raw source

- Client-side `data-owl-id` minting on add/load/duplicate.
- Click in preview selects an element → right panel shows: breadcrumb, Content (text / `href` / `src` / `alt`, or slot note), Styles rows, Attributes rows, HTML source (read/write textarea + Apply, Cmd/Ctrl+Enter).
- Edits write into `section.html` and recompile (debounced).
- `owlId` → section lookup via `sectionHtml` fragment search.

### C — AI full-template compose

- Add `templates.description`/reuse `templates.prompt` as the AI description (meta form field).
- New `owlAiCompose` flow: catalog of starters + design components → LLM returns ordered `sections: [{ key, label, slots }]` + `subject` + `preheader` → server assembles a fresh `OwlDoc` (shell + sections + merged slot values). Strict validation of keys/slot names.
- Studio UI: "Build from description" button (confirms before replacing an existing doc), prefilled from template description.

### D — Verify

- `npm run check`, `npx tsc --noEmit`, `npx vitest run` (baseline: 62 files / 400 passed / 1 skipped).
- Manual: light-by-default preview, click-to-select, live CSS edits, editable source, thumbnails, issues navigation, AI build from description.

### E — AI transparency (required UX)

All AI/Pi flows must stream visible output — **not** spinner-only status text.

The feed must include:

- **System prompt** (collapsible)
- **Context** sent to the model (design.md, assets, section catalog, user instruction)
- **Live tokens** (thinking + response text)
- **Tool calls** (Pi SDK read/edit/write/ls)

Implementation: `$lib/components/ai/AiStreamFeed.svelte` + `$lib/ai/stream-feed.ts`. Documented in root `AGENTS.md` § AI / Pi agent UI.

Owl Studio: compose modal + “Generate copy with AI” panel. Design system: EmailBuilder AI tab (`/design-system/pi-edit` SSE).

Hammer button opens **AI assistant** modal with two tabs: **Build from description** (OpenRouter compose) and **Edit with Pi** (`POST /templates/[id]/owl-pi-edit` SSE — compiles the OwlDoc, Pi edits `email.html`, sections merged back via `mergeEditedHtmlIntoOwlDoc`). Multi-turn Pi sessions supported until modal close.

## Reference files

- `src/lib/components/studio/OwlStudio.svelte` — editor rebuild (main file).
- `src/lib/email/owl/studio-server.ts` — `compileOwlDoc` (add `sectionHtml`).
- `src/lib/email/owl/studio.ts` — OwlDoc envelope (`section.html` is source of truth).
- `src/lib/email/owl/{compile,normalize,style,slots,parser}.ts` — pipeline; minting/extraction helpers.
- `src/routes/(dashboard)/templates/[id]/+page.server.ts` — actions (`owlCompile`, `owlSave`, new `owlAiCompose`; `updateMeta` writes `prompt`).
- `src/routes/(dashboard)/templates/[id]/+page.svelte` — meta form (add description field).
- `src/lib/server/service/ai-owl-service.ts` — prompt builder/parser; extend for compose.
- `src/lib/server/db/schema.ts` — `templates`; `description`/`prompt` column.
- `docs/owl-html.md`, `docs/email-formatting-rules.md` — update as work lands.
