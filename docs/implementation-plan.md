# Implementation plan

Planned work to close gaps between Owlery’s current SES + compose stack and a fuller email marketing product. Items are backlog unless marked in progress / done.

## Inbox QA

**Status:** planned  
**Gap:** No Litmus-style client previews, spam scoring, or link checker.

Pre-send quality checks so operators can catch broken links, spam-trigger patterns, and rendering issues before campaigns or templates go out.

### Goals

1. **Link checker** — crawl rendered HTML for `a[href]` / image `src`; report broken, relative, missing unsubscribe, and suspicious URLs.
2. **Spam scoring** — heuristic / rule-based score (and optional external scorer later) on subject + HTML/text; surface top findings in the UI.
3. **Client previews** — multi-client / viewport previews (Litmus-style). Start with local approximations (desktop/mobile WebKit-ish iframe); evaluate paid APIs (Litmus, Email on Acid, Paragon) as an optional integration rather than a hard dependency.

### Suggested phasing

| Phase | Deliverable |
|-------|-------------|
| **1 — Link checker** | Service that takes template/campaign HTML (post-variable render where possible), returns a structured report; UI on template + campaign detail; block or warn on critical failures. |
| **2 — Spam heuristics** | Local rules (ALL CAPS subject, too many `!`, image-only body, short link domains, missing plain text, etc.) + score; store last run on template/campaign. |
| **3 — Preview pack** | Desktop / mobile preview tabs using existing render pipeline; optional “send test to me” already exists — keep it as the ground-truth path. |
| **4 — External clients (optional)** | Pluggable provider for real Gmail/Outlook/Apple Mail screenshots when API keys are configured. |

### Touchpoints

- Templates: run QA from template editor after compose / before preview send.
- Campaigns: run QA before schedule / resume.
- Shared: `src/lib/server/service/` QA service + Vitest; dashboard panel or modal for results.
- Docs: update [Features](./features.md) when shipped; keep this section status current.

### Non-goals (for this item)

- Replacing SES reputation metrics or post-send analytics.
- Guaranteeing inbox placement (ISP filtering cannot be fully predicted).
- Requiring a third-party SaaS to use basic link/spam checks.
