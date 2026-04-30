import type {
  PackageJson,
  RemoteFileState,
  ToolManifest,
  ToolRemoteState,
  ToolRepository,
} from "../types";

const REQUEST_TIMEOUT_MS = 9000;

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json, text/plain, */*",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function repoUrl(repo: string) {
  return `https://github.com/${repo}`;
}

export function rawFileUrl(repo: ToolRepository, path: string) {
  return `https://raw.githubusercontent.com/${repo.repo}/${repo.branch}/${path}`;
}

export async function readRemoteFile(repo: ToolRepository, path: string): Promise<RemoteFileState> {
  const url = rawFileUrl(repo, path);

  try {
    const response = await fetchWithTimeout(url, { cache: "no-store" });
    const text = response.ok ? await response.text() : "";

    return {
      path,
      ok: response.ok,
      status: response.status,
      size: text.length,
      text,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      path,
      ok: false,
      status: 0,
      size: 0,
      error: error instanceof Error ? error.message : "Fetch failed",
    };
  }
}

async function readJson<T>(repo: ToolRepository, path: string): Promise<T | undefined> {
  const file = await readRemoteFile(repo, path);

  if (!file.ok || !file.text) {
    return undefined;
  }

  try {
    return JSON.parse(file.text) as T;
  } catch {
    return undefined;
  }
}

export async function hydrateRepository(repo: ToolRepository): Promise<ToolRemoteState> {
  const uniqueFiles = Array.from(new Set([repo.manifestPath, ...repo.trackedFiles, ...repo.scriptFiles]));

  try {
    const [manifest, packageJson, files] = await Promise.all([
      readJson<ToolManifest>(repo, repo.manifestPath),
      readJson<PackageJson>(repo, "package.json"),
      Promise.all(uniqueFiles.map((path) => readRemoteFile(repo, path))),
    ]);

    return {
      id: repo.id,
      loading: false,
      checkedAt: new Date().toISOString(),
      repoInfo: {
        html_url: repoUrl(repo.repo),
        default_branch: repo.branch,
        visibility: "public",
      },
      manifest,
      packageJson,
      files,
    };
  } catch (error) {
    return {
      id: repo.id,
      loading: false,
      checkedAt: new Date().toISOString(),
      files: [],
      error: error instanceof Error ? error.message : "Unable to read repository",
    };
  }
}

async function githubWrite<T>(
  repo: ToolRepository,
  token: string,
  path: string,
  body: unknown,
  method = "POST",
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${repo.repo}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as T & { message?: string }) : undefined;

    if (!response.ok) {
      return {
        ok: false,
        error: data?.message ?? `GitHub API HTTP ${response.status}`,
      };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "GitHub action failed",
    };
  }
}

async function githubRead<T>(repo: ToolRepository, token: string, path: string): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const response = await fetchWithTimeout(`https://api.github.com/repos/${repo.repo}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as T & { message?: string }) : undefined;

    if (!response.ok) {
      return { ok: false, error: data?.message ?? `GitHub API HTTP ${response.status}` };
    }

    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "GitHub read failed" };
  }
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function updateJsonVersion(text: string, updater: (json: Record<string, unknown>) => Record<string, unknown>) {
  const json = JSON.parse(text) as Record<string, unknown>;
  return `${JSON.stringify(updater(json), null, 2)}\n`;
}

type RefResponse = {
  object: { sha: string };
};

type ContentResponse = {
  sha: string;
  content: string;
  encoding: string;
};

export async function createGitHubIssue(repo: ToolRepository, token: string, title: string, body: string) {
  return githubWrite<{ html_url: string }>(repo, token, "/issues", {
    title,
    body,
    labels: ["tool-manager"],
  });
}

export async function createDraftRelease(repo: ToolRepository, token: string, version: string, body: string) {
  const tag = version.startsWith("v") ? version : `v${version}`;

  return githubWrite<{ html_url: string }>(repo, token, "/releases", {
    tag_name: tag,
    name: tag,
    body,
    draft: true,
    prerelease: false,
    target_commitish: repo.branch,
  });
}

export async function createVersionSyncPullRequest(
  repo: ToolRepository,
  token: string,
  version: string,
  remote?: ToolRemoteState,
) {
  const cleanVersion = version.replace(/^v/i, "");
  const branchName = `codex/sync-version-${cleanVersion}`;
  const baseRef = await githubRead<RefResponse>(repo, token, `/git/ref/heads/${repo.branch}`);

  if (!baseRef.ok || !baseRef.data) {
    return { ok: false, error: baseRef.error ?? "Cannot read base branch ref" };
  }

  const createBranch = await githubWrite(repo, token, "/git/refs", {
    ref: `refs/heads/${branchName}`,
    sha: baseRef.data.object.sha,
  });

  if (!createBranch.ok && !createBranch.error?.includes("Reference already exists")) {
    return { ok: false, error: createBranch.error };
  }

  const updates: Array<{ path: string; content: string; message: string }> = [];
  const packageFile = remote?.files.find((file) => file.path === "package.json" && file.ok && file.text);
  const manifestFile = remote?.files.find((file) => file.path === repo.manifestPath && file.ok && file.text);
  const changelogFile = remote?.files.find((file) => file.path === "CHANGELOG.md" && file.ok && file.text);

  if (packageFile?.text) {
    updates.push({
      path: "package.json",
      content: updateJsonVersion(packageFile.text, (json) => ({ ...json, version: cleanVersion })),
      message: `sync package version to ${cleanVersion}`,
    });
  }

  if (manifestFile?.text) {
    updates.push({
      path: repo.manifestPath,
      content: updateJsonVersion(manifestFile.text, (json) => ({
        ...json,
        release: {
          ...((json.release as Record<string, unknown> | undefined) ?? {}),
          version: cleanVersion,
        },
      })),
      message: `sync manifest version to ${cleanVersion}`,
    });
  }

  if (changelogFile?.text && !changelogFile.text.includes(`Version: \`${cleanVersion}\``)) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = [
      `## ${today} - Version Sync`,
      "",
      `- Version: \`${cleanVersion}\``,
      "- Type: Metadata",
      "- Status: Needs review",
      "",
      "### Changes",
      "",
      "- Synced package and manifest version metadata.",
      "",
      "### Verification",
      "",
      "- Pending maintainer verification.",
      "",
      "",
    ].join("\n");
    updates.push({
      path: "CHANGELOG.md",
      content: changelogFile.text.replace(/^# Changelog\s*/i, `# Changelog\n\n${entry}`),
      message: `add changelog version ${cleanVersion}`,
    });
  }

  if (updates.length === 0) {
    return { ok: false, error: "No parseable remote files available for version sync" };
  }

  for (const update of updates) {
    const content = await githubRead<ContentResponse>(
      repo,
      token,
      `/contents/${encodeURIComponent(update.path)}?ref=${encodeURIComponent(branchName)}`,
    );

    if (!content.ok || !content.data) {
      return { ok: false, error: content.error ?? `Cannot read ${update.path}` };
    }

    const saved = await githubWrite(
      repo,
      token,
      `/contents/${encodeURIComponent(update.path)}`,
      {
        message: update.message,
        content: encodeBase64(update.content),
        sha: content.data.sha,
        branch: branchName,
      },
      "PUT",
    );

    if (!saved.ok) {
      return { ok: false, error: saved.error };
    }
  }

  return githubWrite<{ html_url: string }>(repo, token, "/pulls", {
    title: `[codex] Sync version ${cleanVersion}`,
    head: branchName,
    base: repo.branch,
    draft: true,
    body: [
      "Syncs version metadata across public tool files.",
      "",
      "Updated files:",
      ...updates.map((update) => `- ${update.path}`),
      "",
      "Validation should run locally before merge.",
    ].join("\n"),
  });
}
