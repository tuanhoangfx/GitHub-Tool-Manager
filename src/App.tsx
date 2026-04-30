import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  Clipboard,
  Code2,
  Download,
  ExternalLink,
  FileCode2,
  Filter,
  GitBranch,
  Github,
  KeyRound,
  LayoutGrid,
  ListChecks,
  PlayCircle,
  RefreshCw,
  Rocket,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Table2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { defaultRepositories, ruleSources } from "./data/repositories";
import {
  createDraftRelease,
  createGitHubIssue,
  createVersionSyncPullRequest,
  hydrateRepository,
  repoUrl,
} from "./services/github";
import type { LocalRegistry, RemoteFileState, ResolvedTool, ToolRemoteState, ToolRepository } from "./types";

type ActiveTab = "store" | "admin" | "github" | "release" | "rules";
type ThemeId = "graphite" | "porcelain" | "sage";

const statusOrder = ["Ready", "Needs review", "Experimental", "Archived"];
const themes: Array<{ id: ThemeId; label: string }> = [
  { id: "graphite", label: "Graphite" },
  { id: "porcelain", label: "Porcelain" },
  { id: "sage", label: "Sage" },
];

function formatDate(value?: string) {
  if (!value) return "Chua co du lieu";

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeVersion(value?: string) {
  return value?.replace(/^v/i, "") ?? "";
}

function firstReleaseAsset(remote?: ToolRemoteState) {
  return remote?.latestRelease?.assets?.[0]?.browser_download_url;
}

function findFile(remote: ToolRemoteState | undefined, path: string) {
  return remote?.files.find((file) => file.path.toLowerCase() === path.toLowerCase());
}

function extractChangelogVersion(remote?: ToolRemoteState) {
  const changelog = findFile(remote, "CHANGELOG.md")?.text ?? "";
  const versionMatch = changelog.match(/-\s*Version:\s*`?v?([0-9]+\.[0-9]+\.[0-9][^`\s]*)`?/i);
  return versionMatch?.[1] ?? "";
}

function createVersionAlerts(remote?: ToolRemoteState) {
  if (!remote) return [];

  const manifestVersion = remote?.manifest?.release?.version ?? "";
  const packageVersion = remote?.packageJson?.version ?? "";
  const releaseVersion = normalizeVersion(remote?.latestRelease?.tag_name);
  const changelogVersion = extractChangelogVersion(remote);
  const sources = [
    ["manifest", manifestVersion],
    ["package", packageVersion],
    ["changelog", changelogVersion],
    ["release", releaseVersion],
  ].filter(([, version]) => Boolean(version));

  const alerts: string[] = [];
  const uniqueVersions = Array.from(new Set(sources.map(([, version]) => version)));

  if (uniqueVersions.length > 1) {
    alerts.push(`Version drift: ${sources.map(([source, version]) => `${source} ${version}`).join(", ")}.`);
  }

  if (packageVersion && !releaseVersion) {
    alerts.push(`Missing release for package v${packageVersion}.`);
  }

  if (!changelogVersion) {
    alerts.push("CHANGELOG.md chua co Version parseable theo Changelog Standard.");
  }

  return alerts;
}

function createSuggestions(tool: ToolRepository, remote?: ToolRemoteState) {
  if (tool.remoteEnabled === false) {
    return ["Tool dang hien thi tu local registry. Publish GitHub repo xong thi bat remote sync lai."];
  }

  const files = remote?.files ?? [];
  const missingFiles = files.filter((file) => !file.ok);
  const missingScripts = missingFiles.filter((file) => tool.scriptFiles.includes(file.path));
  const suggestions: string[] = [];

  if (!remote?.repoInfo) suggestions.push("Kiem tra repo public hoac GitHub API rate limit.");
  if (missingFiles.length > 0) suggestions.push(`Bo sung ${missingFiles.length} file public dang thieu trong repo.`);
  if (missingScripts.length > 0) suggestions.push("Dong bo scripts quan trong len GitHub de tool doc duoc ban moi.");
  if (!remote?.latestRelease) suggestions.push("Tao GitHub Release de nguoi dung co link download ro rang.");
  if (remote?.manifest && !remote.manifest.nextActions?.length) {
    suggestions.push("Them nextActions vao manifest de tab quan tri dua ra roadmap.");
  }

  suggestions.push(...createVersionAlerts(remote));

  return suggestions.length > 0 ? suggestions : ["Repo dang on dinh, co the chi can refresh metadata theo chu ky."];
}

function resolveTool(tool: ToolRepository, remote?: ToolRemoteState): ResolvedTool {
  const version =
    remote?.manifest?.release?.version ||
    remote?.packageJson?.version ||
    normalizeVersion(remote?.latestRelease?.tag_name) ||
    tool.localVersion ||
    "local";

  return {
    ...tool,
    remote,
    version,
    releaseUrl: remote?.latestRelease?.html_url ?? `${repoUrl(tool.repo)}/releases`,
    repoUrl: remote?.repoInfo?.html_url ?? repoUrl(tool.repo),
    downloadUrl: tool.remoteEnabled === false ? repoUrl(tool.repo) : firstReleaseAsset(remote) ?? `${repoUrl(tool.repo)}/releases`,
    healthLabel: remote?.manifest?.health?.status ?? remote?.manifest?.status ?? tool.status,
    updatedAt: remote?.repoInfo?.pushed_at ?? remote?.repoInfo?.updated_at ?? remote?.checkedAt ?? "",
    driftAlerts: createVersionAlerts(remote),
    suggestions: createSuggestions(tool, remote),
  };
}

function countOkFiles(files?: RemoteFileState[]) {
  if (!files?.length) return "0/0";
  return `${files.filter((file) => file.ok).length}/${files.length}`;
}

function mergeRepos(localRepos: ToolRepository[], customRepos: ToolRepository[]) {
  const byRepo = new Map<string, ToolRepository>();

  for (const repo of defaultRepositories) {
    byRepo.set(repo.repo.toLowerCase(), repo);
  }

  for (const repo of localRepos) {
    const key = repo.repo.toLowerCase();
    const current = byRepo.get(key);
    byRepo.set(
      key,
      current
        ? {
            ...current,
            localPath: repo.localPath,
            localVersion: repo.localVersion,
          }
        : repo,
    );
  }

  for (const repo of customRepos) {
    byRepo.set(repo.repo.toLowerCase(), repo);
  }

  return Array.from(byRepo.values());
}

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("store");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(defaultRepositories[0].id);
  const [remoteStates, setRemoteStates] = useState<Record<string, ToolRemoteState>>({});
  const [loadingAll, setLoadingAll] = useState(false);
  const [localRegistry, setLocalRegistry] = useState<LocalRegistry | undefined>();
  const [githubToken, setGithubToken] = useState(() => sessionStorage.getItem("github-tool-manager.token") ?? "");
  const [actionStatus, setActionStatus] = useState("");
  const [theme, setTheme] = useState<ThemeId>(() => (localStorage.getItem("github-tool-manager.theme") as ThemeId | null) ?? "graphite");
  const [customRepos, setCustomRepos] = useState<ToolRepository[]>(() => {
    const raw = localStorage.getItem("github-tool-manager.customRepos");
    if (!raw) return [];

    try {
      return JSON.parse(raw) as ToolRepository[];
    } catch {
      return [];
    }
  });
  const [repoDraft, setRepoDraft] = useState("");

  const repositories = useMemo(
    () => mergeRepos(localRegistry?.repositories ?? [], customRepos),
    [customRepos, localRegistry?.repositories],
  );

  const resolvedTools = useMemo(
    () => repositories.map((repo) => resolveTool(repo, remoteStates[repo.id])),
    [remoteStates, repositories],
  );

  const selectedTool = resolvedTools.find((tool) => tool.id === selectedId) ?? resolvedTools[0];

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();

    return resolvedTools.filter((tool) => {
      const matchesStatus = statusFilter === "All" || tool.healthLabel === statusFilter || tool.status === statusFilter;
      const matchesQuery =
        !q ||
        [tool.name, tool.code, tool.repo, tool.summary, tool.category, tool.audience, ...tool.tags]
          .join(" ")
          .toLowerCase()
          .includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [query, resolvedTools, statusFilter]);

  const stats = useMemo(() => {
    const ready = resolvedTools.filter((tool) => tool.healthLabel === "Ready").length;
    const releases = resolvedTools.filter((tool) => Boolean(tool.remote?.latestRelease)).length;
    const missingFiles = resolvedTools.reduce((sum, tool) => sum + (tool.remote?.files.filter((file) => !file.ok).length ?? 0), 0);
    const drift = resolvedTools.filter((tool) => tool.driftAlerts.length > 0).length;

    return { total: resolvedTools.length, ready, releases, missingFiles, drift };
  }, [resolvedTools]);

  async function refreshOne(repo: ToolRepository) {
    if (!repo.repo) return;

    setRemoteStates((current) => ({
      ...current,
      [repo.id]: { id: repo.id, loading: true, files: current[repo.id]?.files ?? [] },
    }));

    const remote = await hydrateRepository(repo);
    setRemoteStates((current) => ({ ...current, [repo.id]: remote }));
  }

  async function refreshAll() {
    setLoadingAll(true);
    await Promise.all(repositories.map((repo) => refreshOne(repo)));
    setLoadingAll(false);
  }

  async function loadLocalRegistry() {
    try {
      const response = await fetch(`/local-registry.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setLocalRegistry((await response.json()) as LocalRegistry);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : "Khong doc duoc local-registry.json");
    }
  }

  function saveToken(value: string) {
    setGithubToken(value);
    if (value) sessionStorage.setItem("github-tool-manager.token", value);
    else sessionStorage.removeItem("github-tool-manager.token");
  }

  function selectTheme(value: ThemeId) {
    setTheme(value);
    localStorage.setItem("github-tool-manager.theme", value);
  }

  function addRepo() {
    const normalized = repoDraft.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(normalized)) return;
    if (repositories.some((repo) => repo.repo.toLowerCase() === normalized.toLowerCase())) {
      setRepoDraft("");
      return;
    }

    const id = normalized.toLowerCase().replace(/[^\w]+/g, "-");
    const name = normalized.split("/")[1].replaceAll("-", " ");
    const repo: ToolRepository = {
      id,
      code: "CUSTOM",
      name,
      repo: normalized,
      branch: "main",
      category: "Custom",
      audience: "Public users",
      status: "Needs review",
      summary: "Custom public GitHub tool repository added in this browser.",
      localPath: "",
      tags: ["GitHub", "Custom"],
      usage: ["Open README.md from GitHub.", "Use latest release asset when available."],
      downloadHint: "Release asset or repository source.",
      manifestPath: "tool.manifest.json",
      trackedFiles: ["tool.manifest.json", "package.json", "README.md", "CHANGELOG.md"],
      scriptFiles: ["scripts/sync-changelog.mjs", "scripts/sync-metadata-version.mjs"],
    };
    const next = [...customRepos, repo];
    setCustomRepos(next);
    localStorage.setItem("github-tool-manager.customRepos", JSON.stringify(next));
    setRepoDraft("");
    setSelectedId(repo.id);
  }

  function removeCustomRepo(id: string) {
    const next = customRepos.filter((repo) => repo.id !== id);
    setCustomRepos(next);
    localStorage.setItem("github-tool-manager.customRepos", JSON.stringify(next));
    setSelectedId(defaultRepositories[0].id);
  }

  async function copyAdminSummary(tool: ResolvedTool) {
    const lines = [
      `${tool.name} (${tool.repo})`,
      `Version: ${tool.version}`,
      `Health: ${tool.healthLabel}`,
      `Files: ${countOkFiles(tool.remote?.files)}`,
      `Updated: ${formatDate(tool.updatedAt)}`,
      "Suggestions:",
      ...tool.suggestions.map((item) => `- ${item}`),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setActionStatus("Da copy repo summary.");
  }

  async function createIssueForSelected() {
    if (!selectedTool || !githubToken) return;
    setActionStatus("Dang tao GitHub issue...");
    const result = await createGitHubIssue(
      selectedTool,
      githubToken,
      `[Tool Manager] Review ${selectedTool.name}`,
      selectedTool.suggestions.map((item) => `- ${item}`).join("\n"),
    );
    setActionStatus(result.ok ? `Da tao issue: ${result.data?.html_url}` : `Issue failed: ${result.error}`);
  }

  async function createDraftReleaseForSelected() {
    if (!selectedTool || !githubToken) return;
    setActionStatus("Dang tao draft release...");
    const result = await createDraftRelease(
      selectedTool,
      githubToken,
      selectedTool.version,
      [`Automated draft from GitHub Tool Manager.`, "", "Checks:", ...selectedTool.suggestions.map((item) => `- ${item}`)].join("\n"),
    );
    setActionStatus(result.ok ? `Da tao draft release: ${result.data?.html_url}` : `Release failed: ${result.error}`);
  }

  async function createVersionSyncPrForSelected() {
    if (!selectedTool || !githubToken) return;
    setActionStatus("Dang tao version sync PR...");
    const result = await createVersionSyncPullRequest(selectedTool, githubToken, selectedTool.version, selectedTool.remote);
    setActionStatus(result.ok ? `Da tao draft PR: ${result.data?.html_url}` : `Version sync PR failed: ${result.error}`);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLocalRegistry();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (repositories.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      void refreshAll();
    }, 0);
    return () => window.clearTimeout(timer);
    // Initial and registry-load refresh only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositories.length]);

  return (
    <main className={`workspace-shell theme-${theme}`}>
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Boxes size={20} />
          </span>
          <div>
            <p className="eyebrow">Tool Workspace</p>
            <h1>GitHub Tool Manager</h1>
          </div>
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <SideNavButton active={activeTab === "store"} icon={<LayoutGrid size={17} />} label="Tool Store" onClick={() => setActiveTab("store")} />
          <SideNavButton active={activeTab === "admin"} icon={<Table2 size={17} />} label="Repo Admin" onClick={() => setActiveTab("admin")} />
          <SideNavButton active={activeTab === "github"} icon={<Github size={17} />} label="GitHub Actions" onClick={() => setActiveTab("github")} />
          <SideNavButton active={activeTab === "release"} icon={<Rocket size={17} />} label="Release Checklist" onClick={() => setActiveTab("release")} />
          <SideNavButton active={activeTab === "rules"} icon={<ListChecks size={17} />} label="Rules" onClick={() => setActiveTab("rules")} />
        </nav>

        <div className="sidebar-footer">
          <div className="theme-switcher" aria-label="Theme switcher">
            {themes.map((item) => (
              <button
                className={theme === item.id ? "theme-chip active" : "theme-chip"}
                key={item.id}
                type="button"
                onClick={() => selectTheme(item.id)}
              >
                <span className={`theme-dot ${item.id}`} />
                {item.label}
              </button>
            ))}
          </div>
          <button className="primary-action wide" type="button" onClick={refreshAll} disabled={loadingAll}>
            <RefreshCw size={15} className={loadingAll ? "spin" : ""} />
            Refresh remote
          </button>
          <button className="ghost-action wide" type="button" onClick={() => void loadLocalRegistry()}>
            <Upload size={15} />
            Reload local registry
          </button>
          <p>{localRegistry?.generatedAt ? `Local scan: ${formatDate(localRegistry.generatedAt)}` : "Run pnpm scan:local de cap nhat local registry."}</p>
        </div>
      </aside>

      <section className="main-panel">
        <header className="content-header">
          <div>
            <p className="eyebrow">
              {activeTab === "store"
                ? "Public catalog"
                : activeTab === "admin"
                  ? "Repository control"
                  : activeTab === "github"
                    ? "Authenticated actions"
                    : activeTab === "release"
                      ? "Pre-publish gate"
                      : "Workspace rules"}
            </p>
            <h2>
              {activeTab === "store"
                ? "Tool Store"
                : activeTab === "admin"
                  ? "Repo Admin"
                  : activeTab === "github"
                    ? "GitHub Actions"
                    : activeTab === "release"
                      ? "Release Checklist"
                      : "Rules and Standards"}
            </h2>
          </div>
          <div className="header-actions">
            <label className="search-box">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tim tool, repo, tag, version..." type="search" />
            </label>
            <label className="select-box">
              <Filter size={16} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="All">All status</option>
                {statusOrder.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <section className="metrics-grid" aria-label="Workspace metrics">
          <Metric icon={<Boxes size={21} />} label="Total tools" value={stats.total} tone="blue" />
          <Metric icon={<ShieldCheck size={21} />} label="Ready" value={stats.ready} tone="green" />
          <Metric icon={<Download size={21} />} label="Release links" value={stats.releases} tone="teal" />
          <Metric icon={<AlertTriangle size={21} />} label="Drift alerts" value={stats.drift} tone="rose" />
        </section>

        {activeTab === "store" ? (
          <StoreTab tools={filteredTools} selectedId={selectedTool.id} onSelect={setSelectedId} />
        ) : null}
        {activeTab === "admin" ? (
          <AdminTab
            tools={filteredTools}
            allTools={repositories}
            selectedTool={selectedTool}
            repoDraft={repoDraft}
            onRepoDraftChange={setRepoDraft}
            onAddRepo={addRepo}
            onRefresh={refreshOne}
            onSelect={setSelectedId}
            onCopySummary={copyAdminSummary}
            onRemoveCustom={removeCustomRepo}
          />
        ) : null}
        {activeTab === "github" ? (
          <GitHubActionsTab
            selectedTool={selectedTool}
            token={githubToken}
            actionStatus={actionStatus}
            onTokenChange={saveToken}
            onCreateIssue={createIssueForSelected}
            onCreateRelease={createDraftReleaseForSelected}
            onCreateVersionSyncPr={createVersionSyncPrForSelected}
          />
        ) : null}
        {activeTab === "release" ? <ReleaseChecklistTab selectedTool={selectedTool} /> : null}
        {activeTab === "rules" ? <RulesTab /> : null}
      </section>
    </main>
  );
}

function SideNavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "side-nav-item active" : "side-nav-item"} type="button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string | number; tone: "blue" | "green" | "teal" | "amber" | "rose" }) {
  return (
    <article className="metric-tile">
      <span className={`metric-badge ${tone}`}>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function StoreTab({ tools, selectedId, onSelect }: { tools: ResolvedTool[]; selectedId: string; onSelect: (id: string) => void }) {
  const selectedTool = tools.find((tool) => tool.id === selectedId) ?? tools[0];

  return (
    <section className="store-layout">
      <section className="catalog-board">
        <div className="catalog-board-head">
          <div>
            <p className="eyebrow">Catalog</p>
            <h2>{tools.length} public tools</h2>
          </div>
          <span className="board-count">{tools.filter((tool) => tool.healthLabel === "Ready").length} ready</span>
        </div>

        <div className="card-grid">
          {tools.map((tool) => (
            <article className={tool.id === selectedId ? "tool-card selected" : "tool-card"} key={tool.id} onClick={() => onSelect(tool.id)}>
              <div className="card-head">
                <span className="code-pill">{tool.code}</span>
                <span className={`status-dot ${tool.healthLabel === "Ready" ? "ok" : "warn"}`}>
                  {tool.remoteEnabled === false ? "Local only" : tool.healthLabel}
                </span>
              </div>

              <div className="card-main">
                <h2>{tool.name}</h2>
                <p>{tool.summary}</p>
              </div>

              <div className="card-meta-row">
                <span className="version-chip">v{tool.version}</span>
                {tool.driftAlerts.length > 0 ? (
                  <span className="inline-alert">
                    <AlertTriangle size={13} />
                    {tool.driftAlerts.length} drift
                  </span>
                ) : null}
              </div>

              <div className="tag-row">
                {tool.tags.slice(0, 4).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>

              <div className="card-footer">
                <span>{tool.category}</span>
                <ArrowUpRight size={16} />
              </div>
            </article>
          ))}
        </div>
      </section>

      {selectedTool ? (
        <aside className="detail-panel depth-panel">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Public view</p>
              <h2>{selectedTool.name}</h2>
            </div>
            <span className="version-chip">v{selectedTool.version}</span>
          </div>

          <p className="detail-summary">{selectedTool.summary}</p>

          <div className="action-row">
            <a className="primary-action wide" href={selectedTool.downloadUrl} target="_blank" rel="noreferrer">
              <Download size={16} />
              Download
            </a>
            <a className="ghost-action" href={selectedTool.repoUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Repo
            </a>
          </div>

          <section className="info-block">
            <h3>
              <BookOpen size={15} />
              Huong dan su dung
            </h3>
            <ol>
              {selectedTool.usage.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>

          <section className="info-grid">
            <InfoItem label="Category" value={selectedTool.category} />
            <InfoItem label="Audience" value={selectedTool.audience} />
            <InfoItem label="Repo" value={selectedTool.repo} />
            <InfoItem label="Updated" value={formatDate(selectedTool.updatedAt)} />
          </section>
        </aside>
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function AdminTab({
  tools,
  allTools,
  selectedTool,
  repoDraft,
  onRepoDraftChange,
  onAddRepo,
  onRefresh,
  onSelect,
  onCopySummary,
  onRemoveCustom,
}: {
  tools: ResolvedTool[];
  allTools: ToolRepository[];
  selectedTool: ResolvedTool;
  repoDraft: string;
  onRepoDraftChange: (value: string) => void;
  onAddRepo: () => void;
  onRefresh: (tool: ToolRepository) => Promise<void>;
  onSelect: (id: string) => void;
  onCopySummary: (tool: ResolvedTool) => Promise<void>;
  onRemoveCustom: (id: string) => void;
}) {
  const selectedBase = allTools.find((tool) => tool.id === selectedTool.id) ?? selectedTool;
  const manifest = selectedTool.remote?.manifest;
  const files = selectedTool.remote?.files ?? [];
  const scripts = files.filter((file) => selectedTool.scriptFiles.includes(file.path));
  const custom = selectedTool.code === "CUSTOM";

  return (
    <section className="admin-layout">
      <div className="admin-main">
        <div className="section-header">
          <div>
            <p className="eyebrow">Repo operations</p>
            <h2>Quan ly repo public</h2>
          </div>
          <div className="repo-add">
            <input value={repoDraft} onChange={(event) => onRepoDraftChange(event.target.value)} placeholder="owner/repo hoac github.com/owner/repo" />
            <button className="ghost-action" type="button" onClick={onAddRepo}>
              <Sparkles size={15} />
              Add
            </button>
          </div>
        </div>

        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Repo</th>
                <th>Version</th>
                <th>Files</th>
                <th>Drift</th>
                <th>Release</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <tr className={tool.id === selectedTool.id ? "active-row" : ""} key={tool.id} onClick={() => onSelect(tool.id)}>
                  <td>
                    <strong>{tool.name}</strong>
                    <span>{tool.code} / {tool.healthLabel}</span>
                  </td>
                  <td>
                    <a href={tool.repoUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                      {tool.repo}
                    </a>
                  </td>
                  <td>v{tool.version}</td>
                  <td>{countOkFiles(tool.remote?.files)}</td>
                  <td>{tool.driftAlerts.length ? `${tool.driftAlerts.length} alert` : "OK"}</td>
                  <td>{tool.remote?.latestRelease ? "Ready" : "Missing"}</td>
                  <td>{formatDate(tool.updatedAt)}</td>
                  <td>
                    <button
                      className="icon-button"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onRefresh(tool);
                      }}
                      title="Refresh repo"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rules-strip">
          {ruleSources.map((rule) => (
            <article key={rule.label}>
              <ListChecks size={16} />
              <div>
                <strong>{rule.label}</strong>
                <p>{rule.summary}</p>
                <span>{rule.path}</span>
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="admin-side">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Selected repo</p>
            <h2>{selectedTool.name}</h2>
          </div>
          <button className="icon-button" type="button" onClick={() => void onCopySummary(selectedTool)} title="Copy summary">
            <Clipboard size={15} />
          </button>
        </div>

        <div className="repo-meta">
          <InfoItem label="Branch" value={selectedTool.branch} />
          <InfoItem label="Local path" value={selectedTool.localPath || "Custom browser config"} />
          <InfoItem label="Manifest" value={selectedTool.manifestPath} />
          <InfoItem label="Checked" value={formatDate(selectedTool.remote?.checkedAt)} />
        </div>

        <FileListBlock title="Remote files" icon={<FileCode2 size={15} />} files={files} />
        <FileListBlock title="Scripts GitHub" icon={<Code2 size={15} />} files={scripts} empty="Chua doc duoc script nao" />

        <section className="info-block compact">
          <h3>
            <Activity size={15} />
            De xuat
          </h3>
          <ul className="suggestions">
            {selectedTool.suggestions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        {manifest?.nextActions?.length ? (
          <section className="info-block compact">
            <h3>
              <Settings2 size={15} />
              Next actions trong manifest
            </h3>
            <ul className="suggestions">
              {manifest.nextActions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="action-row">
          <a className="ghost-action wide" href={selectedTool.repoUrl} target="_blank" rel="noreferrer">
            <GitBranch size={16} />
            Open GitHub
          </a>
          <button className="ghost-action" type="button" onClick={() => void onRefresh(selectedBase)}>
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        {custom ? (
          <button className="danger-action" type="button" onClick={() => onRemoveCustom(selectedTool.id)}>
            Remove custom repo
          </button>
        ) : null}
      </aside>
    </section>
  );
}

function GitHubActionsTab({
  selectedTool,
  token,
  actionStatus,
  onTokenChange,
  onCreateIssue,
  onCreateRelease,
  onCreateVersionSyncPr,
}: {
  selectedTool: ResolvedTool;
  token: string;
  actionStatus: string;
  onTokenChange: (value: string) => void;
  onCreateIssue: () => Promise<void>;
  onCreateRelease: () => Promise<void>;
  onCreateVersionSyncPr: () => Promise<void>;
}) {
  return (
    <section className="github-layout">
      <div className="admin-main">
        <div className="section-header">
          <div>
            <p className="eyebrow">GitHub token</p>
            <h2>Authenticated actions cho {selectedTool.name}</h2>
          </div>
          <span className={token ? "status-dot ok" : "status-dot warn"}>{token ? "Token ready" : "Token missing"}</span>
        </div>

        <div className="token-box">
          <KeyRound size={18} />
          <input value={token} onChange={(event) => onTokenChange(event.target.value)} placeholder="Fine-grained PAT: Issues + Contents/Metadata" type="password" />
        </div>

        <div className="action-cards">
          <article>
            <h3>
              <Clipboard size={15} />
              Create review issue
            </h3>
            <p>Tao GitHub issue gom cac de xuat hien tai cua repo duoc chon.</p>
            <button className="primary-action" type="button" onClick={() => void onCreateIssue()} disabled={!token}>
              <PlayCircle size={15} />
              Create issue
            </button>
          </article>

          <article>
            <h3>
              <GitBranch size={15} />
              Sync version PR
            </h3>
            <p>Tao branch va draft PR de dong bo package, manifest va changelog version.</p>
            <button className="ghost-action" type="button" onClick={() => void onCreateVersionSyncPr()} disabled={!token}>
              <GitBranch size={15} />
              Create PR
            </button>
          </article>

          <article>
            <h3>
              <Download size={15} />
              Create draft release
            </h3>
            <p>Tao draft release theo version hien tai de ban review truoc khi publish.</p>
            <button className="ghost-action" type="button" onClick={() => void onCreateRelease()} disabled={!token}>
              <Sparkles size={15} />
              Draft release
            </button>
          </article>
        </div>

        {actionStatus ? <div className="status-log">{actionStatus}</div> : null}
      </div>

      <aside className="admin-side">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Selected repo</p>
            <h2>{selectedTool.repo}</h2>
          </div>
          <Github size={20} />
        </div>
        <section className="info-block compact">
          <h3>
            <AlertTriangle size={15} />
            Drift alerts
          </h3>
          <ul className="suggestions">
            {(selectedTool.driftAlerts.length ? selectedTool.driftAlerts : ["Khong co version drift hien tai."]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
        <section className="info-block compact">
          <h3>
            <ShieldCheck size={15} />
            Token safety
          </h3>
          <p className="detail-summary">Token chi luu trong sessionStorage cua trinh duyet nay. Khong commit token vao repo.</p>
        </section>
      </aside>
    </section>
  );
}

function ReleaseChecklistTab({ selectedTool }: { selectedTool: ResolvedTool }) {
  const files = selectedTool.remote?.files ?? [];
  const checks = [
    {
      label: "README.md public",
      passed: Boolean(files.find((file) => file.path === "README.md" && file.ok)),
      detail: "Nguoi dung co huong dan su dung ro rang.",
    },
    {
      label: "CHANGELOG.md parseable",
      passed: Boolean(files.find((file) => file.path === "CHANGELOG.md" && file.ok)) && selectedTool.driftAlerts.every((alert) => !alert.includes("CHANGELOG")),
      detail: "Dung format Changelog Standard va co version moi nhat.",
    },
    {
      label: "Manifest public",
      passed: Boolean(files.find((file) => file.path === selectedTool.manifestPath && file.ok)),
      detail: "Tool Store va Repo Admin doc duoc metadata.",
    },
    {
      label: "Version khong drift",
      passed: selectedTool.driftAlerts.length === 0,
      detail: "Package, manifest, changelog va release metadata dang dong bo.",
    },
    {
      label: "Release link san sang",
      passed: Boolean(selectedTool.remote?.latestRelease),
      detail: "Neu chua co release, co the tao draft release o GitHub Actions.",
    },
    {
      label: "Script sync public",
      passed: selectedTool.scriptFiles.every((script) => files.find((file) => file.path === script && file.ok)),
      detail: "Cac script cap nhat tool co tren GitHub de agent/doc doc duoc.",
    },
  ];
  const passed = checks.filter((check) => check.passed).length;

  return (
    <section className="release-layout">
      <div className="admin-main">
        <div className="section-header">
          <div>
            <p className="eyebrow">Release gate</p>
            <h2>{selectedTool.name}</h2>
          </div>
            <span className={passed === checks.length ? "status-dot ok" : "status-dot warn"}>
              {selectedTool.remoteEnabled === false ? "Local only" : `${passed}/${checks.length} passed`}
          </span>
        </div>

        <div className="checklist">
          {checks.map((check) => (
            <article className={check.passed ? "check-row passed" : "check-row warning"} key={check.label}>
              {check.passed ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <div>
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="admin-side">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Release target</p>
            <h2>v{selectedTool.version}</h2>
          </div>
          <Rocket size={20} />
        </div>
        <section className="info-block compact">
          <h3>
            <Activity size={15} />
            Blocking alerts
          </h3>
          <ul className="suggestions">
            {(selectedTool.suggestions.length ? selectedTool.suggestions : ["Khong co blocking alert."]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </aside>
    </section>
  );
}

function RulesTab() {
  return (
    <section className="rules-page">
      {ruleSources.map((rule) => (
        <article className="rule-card" key={rule.label}>
          <ListChecks size={18} />
          <div>
            <h2>{rule.label}</h2>
            <p>{rule.summary}</p>
            <span>{rule.path}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

function FileListBlock({ title, icon, files, empty }: { title: string; icon: ReactNode; files: RemoteFileState[]; empty?: string }) {
  return (
    <section className="info-block compact">
      <h3>
        {icon}
        {title}
      </h3>
      <div className="file-list">
        {files.length > 0 ? (
          files.map((file) => (
            <span className={file.ok ? "file-ok" : "file-missing"} key={file.path}>
              {file.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
              {file.path}
              <em>{file.ok ? `${file.size}b` : file.error}</em>
            </span>
          ))
        ) : (
          <span className="file-missing">
            <AlertTriangle size={13} />
            {empty ?? "Chua co du lieu"}
          </span>
        )}
      </div>
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="info-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState() {
  return (
    <aside className="detail-panel empty">
      <AlertTriangle size={24} />
      <h2>Khong co tool phu hop</h2>
      <p>Thu xoa bo loc hoac them repo public trong tab quan tri.</p>
      <ArrowUpRight size={18} />
    </aside>
  );
}

export default App;
