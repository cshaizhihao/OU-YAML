import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";

export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string | null;
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
const logFile = path.join(dataDir, "web-update.log");
const repo = process.env.UPDATE_GITHUB_REPO || "cshaizhihao/OU-YAML";

function currentVersion() {
  try {
    const packageJson = JSON.parse(fsSync.readFileSync(path.resolve("package.json"), "utf8"));
    return String(packageJson.version || "0.0.0");
  } catch {
    return process.env.APP_VERSION || "0.0.0";
  }
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "OU-YAML-updater" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const release = await response.json() as { tag_name?: string; html_url?: string; body?: string; published_at?: string };
    const latest = String(release.tag_name || "").replace(/^v/i, "");
    return {
      currentVersion: current,
      latestVersion: latest || null,
      hasUpdate: Boolean(latest) && compareVersions(latest, current) > 0,
      releaseUrl: release.html_url || null,
      releaseNotes: String(release.body || "").slice(0, 6000),
      publishedAt: release.published_at || null,
      agentAvailable: await fs.access(path.join(dataDir, "web-update-agent.enabled")).then(() => true).catch(() => false),
    };
  } finally {
    clearTimeout(timer);
  }
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
