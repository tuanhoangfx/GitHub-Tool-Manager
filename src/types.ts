export type RepoStatus = "Ready" | "Needs review" | "Experimental" | "Archived";

export type ToolRepository = {
  id: string;
  code: string;
  name: string;
  repo: string;
  branch: string;
  category: string;
  audience: string;
  status: RepoStatus;
  summary: string;
  localPath: string;
  tags: string[];
  usage: string[];
  downloadHint: string;
  manifestPath: string;
  trackedFiles: string[];
  scriptFiles: string[];
};

export type ToolManifest = {
  code?: string;
  id?: string;
  name?: string;
  status?: string;
  summary?: string;
  stack?: string[];
  commands?: Record<string, string>;
  docs?: Record<string, string>;
  github?: {
    repo?: string;
    branch?: string;
    manifestPath?: string;
  };
  release?: {
    version?: string;
    readiness?: string[];
  };
  health?: {
    status?: string;
    note?: string;
  };
  nextActions?: string[];
};

export type PackageJson = {
  version?: string;
  description?: string;
  repository?: string | { type?: string; url?: string };
  scripts?: Record<string, string>;
};

export type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
};

export type GitHubRepoInfo = {
  html_url?: string;
  description?: string;
  pushed_at?: string;
  updated_at?: string;
  stargazers_count?: number;
  open_issues_count?: number;
  default_branch?: string;
  visibility?: string;
};

export type LocalRegistry = {
  generatedAt: string;
  root: string;
  repositories: ToolRepository[];
};

export type RemoteFileState = {
  path: string;
  ok: boolean;
  status: number;
  size: number;
  text?: string;
  error?: string;
};

export type ToolRemoteState = {
  id: string;
  loading: boolean;
  checkedAt?: string;
  repoInfo?: GitHubRepoInfo;
  manifest?: ToolManifest;
  packageJson?: PackageJson;
  latestRelease?: GitHubRelease;
  files: RemoteFileState[];
  error?: string;
};

export type ResolvedTool = ToolRepository & {
  remote?: ToolRemoteState;
  version: string;
  releaseUrl: string;
  repoUrl: string;
  downloadUrl: string;
  healthLabel: string;
  updatedAt: string;
  driftAlerts: string[];
  suggestions: string[];
};
