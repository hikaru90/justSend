# Launch checklist (owner)

Remaining GitHub / release steps after the local open-source readiness work.

## Fresh repository (Phase 0.4)

1. Create a new empty repo `hikaru90/owlery` on GitHub (do **not** initialize with README).
2. From a clean tree of this project (no `.env`, no `data/*.db`):

```sh
# Option A — orphan initial commit on a new remote
git checkout --orphan owlery-public
git add -A
git status   # confirm no secrets / no data/*.db
git commit -m "Initial public release of Owlery v0.1.0"
git remote add owlery git@github.com:hikaru90/owlery.git
git push -u owlery owlery-public:main
```

3. Run `gitleaks detect --source . --config .gitleaks.toml` on the new clone.

## Release (Phase 6)

1. Tag and push:

```sh
git tag -a v0.1.0 -m "Owlery v0.1.0"
git push origin v0.1.0
```

2. Create a GitHub Release from the tag; paste notes from [CHANGELOG.md](../CHANGELOG.md); link `ghcr.io/hikaru90/owlery:0.1.0`.
3. Confirm the Docker workflow pushed `ghcr.io/hikaru90/owlery:0.1.0` and `:latest`.
4. Flip the repo **Public** (Settings → General → Danger Zone).
5. Enable **Discussions**; pin a Roadmap issue.
6. Add labels `good first issue`, `help wanted`. Seed candidates from [implementation-plan.md](./implementation-plan.md#inbox-qa) (Inbox QA link-checker).
7. Optional announce: Show HN, r/selfhosted, awesome-selfhosted PR.
