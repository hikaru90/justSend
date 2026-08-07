Found it. Your instinct is right — the preview and the sent email come from **two different sources of truth**:

## Diagnosis

**What the preview shows:** the live, in-memory OwlDoc. Every studio change (picking the light logo, AI compose, Pi edits, reordering) triggers a recompile via `?/owlCompile` → `compileOwlDoc(currentDoc, …)` (OwlStudio.svelte, 250ms debounce).

**What gets sent:** the stale DB snapshot `templates.html`, which is *only* written when you explicitly click "Save template". The "Send" form (`+page.svelte`) posts just the recipient + test variables — **never the doc** — and `sendEmail` uses `template.html` verbatim (`email-service.ts`: "Composed / visually edited HTML is the source of truth").

So: you picked the **light** logo in the studio → preview recompiled and showed it. But the last *saved* HTML still had the **dark** logo baked in (from an earlier compose). The inbox got the saved snapshot. Any unsaved edit diverges from what gets sent — "not at all showing what is sent" is exactly right.

Secondary drift (would bite even right after a save):
- Send/export replace leftover `{{logo}}`/`{{logo_url}}` tokens with the deterministic light pick (`logoExtraProps`); the preview substitutes leftover tokens with gray *sample* placeholders.
- Export endpoint (`export/+server.ts`) and flow-engine sends share the same stale-`template.html` pattern.

**Key constraint:** `email-service.ts` is inside the worker bundle graph (worker → contact-service → double-opt-in-service → email-service), and the full Owl compiler entry (`studio-server.ts`) pulls in `starters.ts`, which uses Vite-only `import.meta.glob(?raw)` — that would crash the esbuild worker bundle. So send-time compile must go through a slim path (`composeEmailHtml` + `applySlotValues` + `compileOwlHtml` — none import starters; verified worker-safe).

## Plan

1. **Slim worker-safe renderer** — new `renderOwlDocHtml(doc, { tokens?, origin? })` in e.g. `src/lib/email/owl/render-doc.ts` (compose → slots → compile → optional URL rewrite), with `compileOwlDoc` refactored to use it so there's exactly one pipeline.
2. **Shared "render template for send" helper** — OwlDoc content → fresh compile with current design tokens; legacy templates fall back to today's behavior. Used by all send paths.
3. **`sendEmail`** — for `templateId` sends, compile from the stored OwlDoc instead of trusting the cached `template.html`. Fixes API/transactional sends.
4. **`sendPreview` action** — accept the current doc from the form, compile it, **persist it** (save-then-send, so DB/preview/API all agree), and send that exact HTML.
5. **`+page.svelte`** — append `serializeOwlDoc(studio.getCurrentDoc())` to the Send-preview form.
6. **Export endpoint** — use the same helper.
7. **Placeholder parity** — studio passes the deterministic light-logo URL as `logo`/`logo_url` overrides into `substitutePreviewPlaceholders`, so even leftover `{{logo}}` tokens match between preview and send.
8. **Tests** — renderer parity with `compileOwlDoc`; email-service sends doc-compiled HTML when stored HTML is stale (dark cached, light in doc → light gets sent); update tests asserting the old trust-stale-html behavior. Run vitest + typecheck.

One judgment call to confirm: in step 4, "Send preview" would **also save** the current doc (so what you see = what's stored = what's sent, including future API sends). Alternative: send the on-screen HTML without saving — but then the DB stays stale.