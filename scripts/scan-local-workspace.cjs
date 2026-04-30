const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = process.env.TOOL_WORKSPACE || path.resolve(__dirname, "..", "..");
const outputPath = path.resolve(__dirname, "..", "public", "local-registry.json");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function normalizeRepo(value) {
  if (!value) return "";
  if (typeof value === "string") {
    return value.replace(/^git\+/, "").replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "");
  }
  return normalizeRepo(value.url);
}

function toToolRepository(dir, index) {
  const manifestPath = path.join(dir, "tool.manifest.json");
  const packagePath = path.join(dir, "package.json");
  const manifest = readJson(manifestPath);
  const packageJson = readJson(packagePath);

  if (!manifest && !packageJson) {
    return undefined;
  }

  const folderName = path.basename(dir);
  const repo = manifest?.github?.repo || normalizeRepo(packageJson?.repository);
  const id =
    manifest?.id ||
    packageJson?.name ||
    folderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    id,
    code: manifest?.code || `LOCAL-${String(index + 1).padStart(3, "0")}`,
    name: manifest?.name || folderName,
    repo: repo || "",
    branch: manifest?.github?.branch || "main",
    remoteEnabled: Boolean(repo),
    localVersion: packageJson?.version || manifest?.release?.version || "local",
    category: manifest?.type || "Local",
    audience: "Tool maintainers",
    status: manifest?.status || "Needs review",
    summary: manifest?.summary || packageJson?.description || "Local workspace tool discovered by scanner.",
    localPath: dir,
    tags: manifest?.stack || ["Local", "Workspace"],
    usage: [
      manifest?.commands?.dev ? `Dev: ${manifest.commands.dev}` : "Run the configured dev command from package.json.",
      manifest?.commands?.build ? `Build: ${manifest.commands.build}` : "Run the configured build command from package.json.",
    ],
    downloadHint: "Use GitHub release asset when available, otherwise clone the repository.",
    manifestPath: manifest?.github?.manifestPath || "tool.manifest.json",
    trackedFiles: ["tool.manifest.json", "package.json", "README.md", "CHANGELOG.md", "RELEASE.md"],
    scriptFiles: fs.existsSync(path.join(dir, "scripts"))
      ? fs
          .readdirSync(path.join(dir, "scripts"))
          .filter((file) => /\.(cjs|mjs|js|ps1)$/i.test(file))
          .slice(0, 6)
          .map((file) => `scripts/${file}`)
      : ["scripts/sync-changelog.mjs", "scripts/sync-metadata-version.mjs"],
  };
}

const repositories = fs
  .readdirSync(workspaceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
  .map((entry, index) => toToolRepository(path.join(workspaceRoot, entry.name), index))
  .filter(Boolean)
  .filter((repo) => repo.repo || repo.remoteEnabled === false);

const registry = {
  generatedAt: new Date().toISOString(),
  root: workspaceRoot,
  repositories,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Wrote ${repositories.length} repositories to ${outputPath}`);
