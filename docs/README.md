# Owlery documentation

Self-hosted email infrastructure for transactional and marketing email via Amazon SES.

| Document | Contents |
|----------|----------|
| [Overview](./overview.md) | What Owlery is, origin, stack, how to run |
| [Architecture](./architecture.md) | Processes, data model, queue, API/dashboard layout |
| [Design decisions](./design-decisions.md) | Explicit product and technical choices |
| [Features](./features.md) | Product capabilities by area |
| [Deployment](./deployment.md) | Docker, SES/SNS, reverse proxy, backups, upgrades |
| [API](./api.md) | `/api/v1` REST reference with curl examples |
| [Implementation plan](./implementation-plan.md) | Planned gaps (e.g. Inbox QA) |
| [Open-source readiness plan](./open-source-readiness-plan.md) | Audit + phased plan to publish Owlery as an open-source repo |
| [Launch checklist](./launch-checklist.md) | Owner steps: fresh GitHub repo, tag v0.1.0, go public |

Related docs:

- Root: [`README.md`](../README.md), [`AGENTS.md`](../AGENTS.md), [`LICENSE`](../LICENSE), [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`SECURITY.md`](../SECURITY.md), [`CHANGELOG.md`](../CHANGELOG.md)
- [`email-formatting-rules.md`](./email-formatting-rules.md) — AI template generation formatting rules
- [`scripts/README.md`](../scripts/README.md) — production supervisor, worker build, DB tools
