# Owl HTML v1 — Format Specification

Owl HTML is the annotated, table-based email HTML format that is Owlery's single
source of truth for email composition. It is deterministic: the compiler is a
pure function (`same input bytes → same output bytes`), so recompiling
already-compiled output is a fixed point.

Reference implementation: `src/lib/email/owl/` (Vitest suite in
`src/lib/email/owl/compile.test.ts`).

## 1. Model

An email is a **shell** plus an ordered list of **sections**.

- **Shell** — a full HTML document with `<head>` (base CSS, dark CSS, meta), a
  preheader element, a body backdrop, and the single composition anchor
  `<!--owl:sections-->`.
- **Section** — a fragment (typically one `<table role="presentation">`) that
  carries a `data-owl-component` marker. Sections are authored independently
  and spliced into the shell in order at send/compile time.

Both are plain `.owl.html` files. The shell lives on the template; sections
live in the component library (`design_components.html`).

```
┌────────────────────────── shell ──────────────────────────┐
│ <head> base css · dark css · color-scheme meta · mso xml  │
│ <body> preheader · backdrop table                          │
│        └─ column table → <!--owl:sections-->               │
└────────────────────────────────────────────────────────────┘
                            │ splice, in order
    section 1 (logo-header) │  section 2 (heading) │  … │ section N
```

## 2. Document anatomy (shell)

```html
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>…</title>
  <style data-owl-base-css="">
    /* global reset, logo-light/logo-dark swap, .owl-stack mobile rules */
  </style>
  <style data-owl-dark-css=""></style>   <!-- compiler fills this -->
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;" data-owl-dark-style="background-color:#0a0a0a;">
  <div data-owl-preheader data-owl-slot="preheader" data-owl-slot-type="text"
       style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Preview text</div>
  <table role="presentation" data-owl-role="shell" … bgcolor="#F5F5F5">…</table>
  <!--owl:sections-->   <!-- the composition anchor -->
</body>
</html>
```

The body backdrop color is declared with `data-owl-dark-style` so the compiler
can emit its dark-mode override; body and outer tables may also set a
`bgcolor` attribute for clients that do not support CSS `background-color`.

## 3. Annotation vocabulary

All annotations are inert `data-owl-*` attributes (plus two comment anchors and
three class prefixes). None of them affect rendering; the compiler consumes
them and may rewrite inline style / emit CSS.

| Annotation | Meaning |
|---|---|
| `data-owl-id` | Stable element id (`w1`, `w2`, …) assigned in document order at normalize time; preserved across recompiles when already present. Drives selection and CSS-class derivation (`owld-<id>`). |
| `data-owl-component` | Component name on the root element of a section (e.g. `logo-header`). |
| `data-owl-role` | `shell` (on the shell's wrapper table) or `section`. |
| `data-owl-slot` | Declares an editable content target; value is the slot name. |
| `data-owl-slot-type` | Slot value type: `text`, `url`, `image`, `color`, `boolean`. |
| `data-owl-slot-label` | Human label for the slot (drives the Content panel / AI prompts). |
| `data-owl-dark-style` | Inline style to apply in dark mode, e.g. `background-color:#1a1a1a;color:#f2f2f2`. |
| `data-owl-token` | Design-token reference resolved to literals at compile time, e.g. `color:primary`. |
| `data-owl-dark-token` | Dark-variant token reference, resolved before dark emission. |
| `data-owl-variant` | Content-variant role: `light` or `dark`. Marks which side of a light/dark content pair this element is. |
| `data-owl-variant-group` | Shared id linking a light/dark content pair (e.g. `hero`, `logo`). Both partners must share the same value. |
| `data-owl-preheader` | Marks the element whose text is the preheader; the compiler replaces only its first text node so authored filler survives, and guarantees the filler run (see §8). |
| `data-owl-boolean` | Marks a region gated by a boolean slot; hidden (`display:none;mso-hide:all`) when the slot value is false. |
| `data-owl-dark-css` / `data-owl-base-css` | Marks the two `<style>` containers in `<head>` that the compiler owns. |
| `<!--owl:sections-->` | Composition anchor where section fragments are spliced in. |
| `<!--owl:preheader-->` | Fallback anchor: preheader is injected as a hidden div here when the document has no `[data-owl-preheader]` element. |

### Class prefixes

| Class | Purpose |
|---|---|
| `owld-<data-owl-id>` | Dark-mode override emitted by the compiler into `<style data-owl-dark-css>`. |
| `owl-stack` | Authored in components; collapses stacked cells on mobile via the base CSS `@media` rule. |
| `owl-light` / `owl-dark` | Content-variant pair; base CSS shows one per color scheme. |
| `logo-light` / `logo-dark` | Legacy logo aliases of `owl-light` / `owl-dark` (still supported). |

### Banned and healed content

`heal` removes `script`, `iframe`, `object`, `embed`, `form`, `input`,
`button`, `select`, `textarea`, and `noscript` from the body, and `meta`/`link`
**outside** the head. It strips `on*` event attributes and
`javascript:`/`vbscript:`/`data:` `href`/`src`/`background` values, moves stray
`<style>` into `<head>`, and wraps bare `<tr>` runs in `<tbody>`.

## 4. Slots

A slot is an element with `data-owl-slot="<name>"` and a `data-owl-slot-type`.
Values are applied by `applySlotValues`:

| Type | Semantics |
|---|---|
| `text` | Replaces the element's text (first text node preserved where the preheader filler must survive). |
| `url` | Sets `href` on `<a>` (or `src` on `<img>`). |
| `image` | Sets `src` on `<img>`. When the element is a light-variant partner, also syncs `src` onto the dark partner unless `<slot>_dark` is set. |
| `color` | Appends `background-color` (or `color`) to the element's inline style. |
| `boolean` | When false: adds `display:none;mso-hide:all`; when true: removes them. |

**Content pairs (light/dark).** Email clients cannot swap an attribute via a media query, so content that differs per scheme (images, optional text) uses a **pair** of elements:

```html
<img class="owl-light" data-owl-variant="light" data-owl-variant-group="hero"
     data-owl-slot="hero" data-owl-slot-type="image" src="…light…">
<img class="owl-dark" data-owl-variant="dark" data-owl-variant-group="hero"
     style="display:none;" src="…dark…">
```

Base CSS hides `.owl-dark` / `.logo-dark` by default and swaps them under
`@media (prefers-color-scheme: dark)`. Filling the light slot syncs `src` to
the dark partner. An optional `<slot>_dark` value in `slotValues` (e.g.
`hero_dark`, `logo_dark`) fills the dark partner independently and skips the
auto-sync. Legacy `.logo-light`/`.logo-dark` pairs without a group still work
via sibling lookup. Slots are discovered by `extractSlots` / `slotsFromFragment`.

## 5. Dark mode

Strategy (client reality: `@media (prefers-color-scheme)` works in ~42% of
clients; **no Gmail client supports it**; Outlook.com/mobile/macOS partially
support `data-ogsc`/`data-ogsb` "mixed" attributes; Gmail caps `<style>` at
16 KB):

1. Author per-element **CSS** overrides as `data-owl-dark-style`.
2. The compiler derives `owld-<data-owl-id>` classes and emits one rule per
   element into `<style data-owl-dark-css>`:
   `@media (prefers-color-scheme:dark){.owld-w6{…!important}}`.
3. For clients with no media-query support, the compiler mirrors
   `background-color` → `data-ogsb` and `color` → `data-ogsc` on the element.
4. Author per-scheme **content** (images, etc.) as an `owl-light`/`owl-dark`
   pair sharing `data-owl-variant-group` (see §4). Base CSS swaps visibility.
5. Forced preview: with `colorScheme:'dark'`, `promoteDarkStyles` inlines every
   dark value onto the element's `style` and empties the dark-CSS block. The
   studio preview also toggles `.owl-light`/`.owl-dark` via
   `data-color-scheme` on the preview root.

**Studio inspector.** The right panel has **Light | Dark** tabs at the top.
The active tab is linked to the preview color scheme. Light edits base
`style` / attributes / content; Dark edits `data-owl-dark-style` (with the
same color/size/enum controls) and, when a content pair exists, the dark
partner's attributes and image `src`. "Add dark partner" mints an
`owl-dark` sibling for unpaired elements.

Known limitations (documented, not worked around): Yahoo Android strips the
first `<head>` (two-head workaround rejected), and Gmail's 16 KB style cap —
lint flags oversized style blocks.

## 6. Design tokens

`data-owl-token="color:primary"` (and `data-owl-dark-token`) reference the
design system's token map, resolved to literal CSS declarations at compile
time. Unknown tokens are kept as-is and reported as warnings.

## 7. Compiler pipeline

`compileOwlHtml(sourceHtml, ctx)` — `src/lib/email/owl/compile.ts`:

```
parse → heal → normalize → tokens → dark → preheader → serialize
        → fluidify → lint
```

- **parse** — linkedom pins parsing/serializing. The serializer is a fixed
  point: re-parsing serialized output and re-serializing is byte-identical,
  with an entity post-pass keeping `&nbsp;` / `&zwnj;` readable and idempotent.
- **heal** — structural + security fixes (§3).
- **normalize** — assigns stable `data-owl-id` in document order, preserving
  existing ids.
- **tokens** — resolves `data-owl-token` references (§6).
- **dark** — emits `owld-*` rules + `data-ogsc`/`data-ogsb` mirrors (§5).
- **preheader** — injects/overrides the preheader text (§8).
- **serialize + fluidify** — canonical serialization, then the final
  fluid-layout pass (`fluidifyEmailHtml`, reused from the current pipeline).
- **lint** — non-throwing checks against the final shape (§9).

Guarantees:

- Pure and deterministic — enforced by tests.
- Never throws — it heals instead and returns issues alongside output.
- Recompiling compiled output is a fixed point.

`composeEmailHtml(shellHtml, sectionsHtml[], {preheader})` splices section
fragments into the shell at `<!--owl:sections-->` and fills the preheader; its
output is the input to `compileOwlHtml`.

## 8. Preheader

`[data-owl-preheader]` text is the preview. The compiler:

1. Replaces only the **first text node** of the preheader element, so any
   authored filler after it survives.
2. Appends the `OWL_FILLER` run (`&nbsp;&zwnj;` × N) when it is not already
   present (guarded by the trailing ZWNJ), so inbox clients do not pull later
   body copy into the preview.

## 9. Lint rules

Non-throwing checks returned as `issues` with severity; `owlId` attached where
applicable:

| Code | Severity | Condition |
|---|---|---|
| `lint.lang-missing` | warning | `<html>` has no `lang`. |
| `lint.unsubscribe-missing` | error | `kind: 'marketing'` and no `{{unsubscribe_url}}` link. |
| `lint.style-over-limit` | warning | `<style>` content > 16 KB (Gmail cap). |
| `lint.img-missing-alt` | warning | `<img>` without `alt`. |
| `lint.img-missing-src` | error | `<img>` without `src`. |
| `lint.link-missing-href` | error | `<a>` without `href`. |
| `lint.table-missing-role` | warning | `<table>` without `role="presentation"`. |
| `lint.unsupported-bgcolor` | warning | `background` attribute without a matching inline `background-color`. |
| `lint.font-size-small` | warning | inline `font-size` below 14px. |
| `lint.class-without-inline` | warning | element carries a class but no inline style (class-only styling breaks in many clients). |

## 10. Storage and runtime

- `templates.html` and `design_components.html` (schema)
  become Owl HTML source of truth — see the migration task. Templates store the
  compiled final HTML in `templates.html` and the editable source — an **OwlDoc**
  JSON envelope (shell + ordered sections + preheader + slot values) in
  `templates.content` (see `src/lib/email/owl/studio.ts`).
- Migration is lazy and lossless enough: opening a template whose `content` is
  not an Owl envelope runs `migrateToOwlDoc` (`src/lib/email/owl/studio-server.ts`),
  which extracts annotated sections from the existing compiled HTML and carries
  preheader + slot values over from the legacy content JSON. The result is
  persisted the first time the template is saved from the studio. Design
  components already ship as Owl section fragments (`design_components.html`) and
  need no conversion.
- The **studio editor** (`src/lib/components/studio/OwlStudio.svelte`, route
  `templates/[id]`) is the visual editor: section library (starters + design
  components), live compiled preview with light/dark and desktop/mobile toggles,
  and a slot inspector. It compiles via the `?/owlCompile` action and persists
  via `?/owlSave`. Legacy email-builder templates are migrated to OwlDoc on load
  (`migrateToOwlDoc` in `src/lib/email/owl/studio-server.ts`).
- Send-time render stays on the existing path (`templates.html` +
  `replaceVariables` + `absolutizeEmailAssetUrls`); the compiler runs when the
  studio saves, producing final inbox HTML.
- Starter components ship under `src/lib/email/owl/starters/*.owl.html`
  (discovered via `import.meta.glob`, Vite-only — do not import `starters.ts`
  from tsx/worker scripts) and are exposed through `starterByKey`.

## 11. AI authoring (v2)

- `POST /templates/[id]/owl-ai` streams `GenerateProgressEvent`-style SSE events
  (preparing / calling_model / delta / done / error / cancelled) and ends with a
  `done` event whose `content` is `{ subject?, preheader?, slots }`
  (`src/routes/(dashboard)/templates/[id]/owl-ai/+server.ts`).
- `generateOwlScaffold` (`src/lib/server/service/ai-owl-service.ts`) extracts the
  allowed slot set from the document's section fragments (or a single section via
  `sectionId`), builds the prompt from the design system + email formatting rules,
  streams OpenRouter tokens, and validates slot keys against the allowed set.
  It never writes to the DB — the studio applies the result locally and commits
  through `?/owlSave` (subject is surfaced via the `onSubjectSuggest` callback).
- Logo pairs from the design system are injected into `logo*` slots when the model
  omits them; all values are relativized to `/api/design-asset/...` on the way back.
