# Release

## Current

- Version: `0.1.0`
- Status: Ready
- Channel: GitHub public repository

## Publish

```powershell
corepack pnpm lint
corepack pnpm build
corepack pnpm publish:github
```

## Notes

- Use `corepack pnpm scan:local` before publishing if local tool registry data changed.
- Revoke any exposed GitHub token after publishing.
