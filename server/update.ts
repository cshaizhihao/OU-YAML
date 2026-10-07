import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
  currentCommit: string | null;
  latestCommit: string | null;
  updateKind: "version" | "build" | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  releaseNotes: string;
  publishedAt: string | null;
  agentAvailable: boolean;
};

export type UpdateStatus = {
  status: "idle" | "requested" | "running" | "completed" | "failed";
  message: string;
  progress: number;
  updatedAt: string | null;
};

const dataDir = process.env.DATA_DIR || path.resolve("data");
const requestFile = path.join(dataDir, "web-update-request.json");
const statusFile = path.join(dataDir, "web-update-status.json");
const logFile = process.env.OU_YAML_UPDATE_LOG || "/var/log/ou-yaml/web-update.log";
const repo = process.env.UPDATE_GITHUB_REPO || "cshaizhihao/OU-YAML";
const packageJsonFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");

function currentVersion() {
  try {
    const packageJson = JSON.parse(fsSync.readFileSync(packageJsonFile, "utf8"));
    return String(packageJson.version || "0.0.0");
  } catch {
    return process.env.APP_VERSION || "0.0.0";
  }
}

function normalizeCommit(value: string | undefined) {
  const commit = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
}

function commitsMatch(left: string, right: string) {
  return left === right || left.startsWith(right) || right.startsWith(left);
}


export function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function readUpdateStatus(): Promise<UpdateStatus> {
  return readJson(statusFile, { status: "idle", message: "等待操作", progress: 0, updatedAt: null });
}

export async function readUpdateLog() {
  try {
    const content = await fs.readFile(logFile, "utf8");
    return content.slice(-20000);
  } catch {
    return "";
  }
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = currentVersion();
  const installedCommit = normalizeCommit(process.env.APP_COMMIT);
  const agentAvailable = await fs.access(path.join(dataDir, "web-update-agent.enabled")).then(() => true).catch(() => false);
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "OU-YAML-updater" };
  const request = async (url: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try { return await fetch(url, { headers, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };

  const [releaseResult, commitResult, manifestResult] = await Promise.allSettled([
    request(`https://api.github.com/repos/${repo}/releases/latest`),
    request(`https://api.github.com/repos/${repo}/commits/main`),
    request(`https://raw.githubusercontent.com/${repo}/main/package.json`),
  ]);
  let releaseVersion = "";
  let mainVersion = "";
  let latestCommit: string | null = null;
  let latestCommitMessage = "";
  let latestCommitUrl: string | null = null;
  let latestCommitPublishedAt: string | null = null;
  let releaseUrl: string | null = null;
  let releaseNotes = "";
  let publishedAt: string | null = null;
  const releaseResponse = releaseResult.status === "fulfilled" ? releaseResult.value : null;
  if (releaseResponse?.ok) {
    const release = await releaseResponse.json() as { tag_name?: string; html_url?: string; body?: string; published_at?: string };
    releaseVersion = String(release.tag_name || "").replace(/^v/i, "");
    releaseUrl = release.html_url || null;
    releaseNotes = String(release.body || "").slice(0, 6000);
    publishedAt = release.published_at || null;
  }

  const manifestResponse = manifestResult.status === "fulfilled" ? manifestResult.value : null;
  if (manifestResponse?.ok) {
    const manifest = await manifestResponse.json() as { version?: string };
    mainVersion = String(manifest.version || "").replace(/^v/i, "");
  }

  const commitResponse = commitResult.status === "fulfilled" ? commitResult.value : null;
  if (commitResponse?.ok) {
    const commit = await commitResponse.json() as { sha?: string; html_url?: string; commit?: { message?: string; committer?: { date?: string } } };
    latestCommit = normalizeCommit(commit.sha);
    latestCommitMessage = String(commit.commit?.message || "").split("\n")[0].slice(0, 300);
    latestCommitUrl = commit.html_url || `https://github.com/${repo}/commits/main`;
    latestCommitPublishedAt = commit.commit?.committer?.date || null;
    if (!releaseUrl) releaseUrl = latestCommitUrl;
    if (!publishedAt) publishedAt = latestCommitPublishedAt;
  }

  const latest = mainVersion || releaseVersion;
  if (!latest) {
    const status = manifestResponse?.status || releaseResponse?.status;
    throw new Error(`无法读取 GitHub 最新版本${status ? `（HTTP ${status}）` : ""}`);
  }
  if (mainVersion && releaseVersion && compareVersions(mainVersion, releaseVersion) !== 0) {
    releaseUrl = latestCommitUrl || `https://github.com/${repo}/commits/main`;
    releaseNotes = "";
    publishedAt = latestCommitPublishedAt;
  }
  const versionComparison = compareVersions(latest, current);
  const versionUpdate = versionComparison > 0;
  const buildUpdate = versionComparison === 0 && Boolean(installedCommit && latestCommit && !commitsMatch(installedCommit, latestCommit));
  const updateKind = versionUpdate ? "version" : buildUpdate ? "build" : null;
  if (!releaseNotes) {
    releaseUrl = releaseUrl || `https://github.com/${repo}/commits/main`;
    releaseNotes = latestCommitMessage
      ? `main 分支最新构建：${latestCommitMessage}`
      : "当前更新依据 main 分支的版本与构建提交检查。";
  } else if (updateKind === "build" && latestCommitMessage) {
    releaseNotes = `main 分支有新构建：${latestCommitMessage}`;
    releaseUrl = `https://github.com/${repo}/commits/main`;
  }
  return {
    currentVersion: current,
    latestVersion: latest || null,
    currentCommit: installedCommit,
    latestCommit,
    updateKind,
    hasUpdate: Boolean(updateKind),
    releaseUrl,
    releaseNotes,
    publishedAt,
    agentAvailable,
  };
}

export async function requestWebUpdate(user: string) {
  await fs.mkdir(dataDir, { recursive: true });
  const status = await readUpdateStatus();
  if (status.status === "requested" || status.status === "running") throw new Error("更新正在进行中，请稍候");
  const requestedAt = new Date().toISOString();
  const payload = JSON.stringify({ requestedBy: user, requestedAt });
  const temporary = `${requestFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, payload, { mode: 0o600 });
  await fs.rename(temporary, requestFile);
  const statusTemporary = `${statusFile}.${process.pid}.tmp`;
  await fs.writeFile(statusTemporary, JSON.stringify({ status: "requested", message: "更新任务已排队", progress: 1, updatedAt: requestedAt }), { mode: 0o600 });
  await fs.rename(statusTemporary, statusFile);
  return { accepted: true };
}
