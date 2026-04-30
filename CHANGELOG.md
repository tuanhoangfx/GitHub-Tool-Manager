# Changelog

## 2026-04-30 - Initial Tool Manager

- Version: `0.1.0`
- Timestamp: 2026-04-30 00:00 (UTC+7)
- Commit: pending
- Type: Feature
- Status: Stable

### Changes

- Added public Tool Store card view.
- Added Repo Admin table for GitHub repository health and update suggestions.
- Added public GitHub raw file readers for manifest, README, changelog, package, and configured scripts.
- Reworked navigation into a left sidebar console layout.
- Added local workspace scanner merge through `corepack pnpm scan:local`.
- Added GitHub token actions for creating review issues and draft releases.
- Added version drift alerts across package, manifest, changelog, and release metadata.

### Verification

- `corepack pnpm build`
- `corepack pnpm lint`
- Browser verification at `http://127.0.0.1:5176/`
- Result: passed

### Rollback

```powershell
cd E:\Dev\Tool\GitHub-Tool-Manager
git revert <commit_hash>
```
