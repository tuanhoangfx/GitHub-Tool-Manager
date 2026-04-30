# GitHub Tool Manager

Two-tab console for public workspace tools:

- **Tool Store:** card view for normal users with search, usage, version, repository, and download links.
- **Repo Admin:** detail table for repository management, GitHub raw file status, version drift, and recommendations.
- **GitHub Actions:** session-only token input for creating review issues and draft releases.
- **Rules:** local rule/standard source map for workspace design and working rules.

The app reads public GitHub files through unauthenticated browser requests:

- `tool.manifest.json`
- `package.json`
- `README.md`
- `CHANGELOG.md`
- configured script files such as `scripts/sync-changelog.mjs`

## Commands

```powershell
corepack pnpm install
corepack pnpm scan:local
corepack pnpm dev
corepack pnpm build
```

Publish the manager repository without `gh`:

```powershell
$env:GITHUB_TOKEN="your_fine_grained_token"
corepack pnpm publish:github
```

## Configuration

Edit `src/data/repositories.ts` to add or remove public GitHub repositories.

Run `corepack pnpm scan:local` to merge local tool manifests into `public/local-registry.json`. The scanner excludes this manager app until its GitHub repository is published.
