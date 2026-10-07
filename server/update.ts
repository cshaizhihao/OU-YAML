import fs from "node:fs/promises";
import path from "node:path";
import fsSync from "node:fs";
import { fileURLToPath } from "node:url";

export type UpdateChannel = "stable" | "preview";
export type UpdateInfo = {
  currentVersion: string; latestVersion: string | null; currentCommit: string | null; latestCommit: string | null;
  updateKind: "version" | "build" | null; hasUpdate: boolean; releaseUrl: string | null; releaseNotes: string;
  publishedAt: string | null; agentAvailable: boolean; channel: UpdateChannel;
};
export type UpdateStatus = { status: "idle" | "requested" | "running" | "completed" | "failed"; message: string; progress: number; updatedAt: string | null };

const dataDir = process.env.DATA_DIR || path.resolve("data");
const requestFile = path.join(dataDir, "web-update-request.json");
const statusFile = path.join(dataDir, "web-update-status.json");
const logFile = process.env.OU_YAML_UPDATE_LOG || "/var/log/ou-yaml/web-update.log";
const repo = process.env.UPDATE_GITHUB_REPO || "cshaizhihao/OU-YAML";
const packageJsonFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");

function currentVersion() {
  try { return String(JSON.parse(fsSync.readFileSync(packageJsonFile, "utf8")).version || "0.0.0"); }
  catch { return process.env.APP_VERSION || "0.0.0"; }
}
function normalizeCommit(value: unknown) {
  const commit = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(commit) ? commit : null;
}
export function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const first = parse(left);
  const second = parse(right);
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) if ((first[index] || 0) !== (second[index] || 0)) return (first[index] || 0) - (second[index] || 0);
  return 0;
}
export async function readUpdateStatus(): Promise<UpdateStatus> {
  try { return JSON.parse(await fs.readFile(statusFile, "utf8")) as UpdateStatus; }
  catch { return { status: "idle", message: "等待操作", progress: 0, updatedAt: null }; }
}
export async function readUpdateLog() {
  try { return (await fs.readFile(logFile, "utf8")).slice(-20000); } catch { return ""; }
}
async function requestJson(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "OU-YAML-updater" }, signal: AbortSignal.timeout(12000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
  return await response.json() as Record<string, any>;
}
export async function checkForUpdate(channel: UpdateChannel = "stable"): Promise<UpdateInfo> {
  const current = currentVersion();
  const installedCommit = normalizeCommit(process.env.APP_COMMIT);
  const agentAvailable = await fs.access(path.join(dataDir, "web-update-agent.enabled")).then(() => true).catch(() => false);
  let version: string;
  let commit: Record<string, any> | null;
  let release: Record<string, any> | null;
  if (channel === "stable") {
    release = await requestJson(`https://api.github.com/repos/${repo}/releases/latest`);
    if (!release || release.prerelease || release.draft || !/^v?\d+\.\d+\.\d+$/.test(String(release.tag_name))) throw new Error("当前没有可用稳定版本，请稍后检查或选择测试版渠道");
    version = String(release.tag_name).replace(/^v/, "");
    commit = await requestJson(`https://api.github.com/repos/${repo}/commits/${release.tag_name}`);
  } else {
    const results = await Promise.all([
      requestJson(`https://api.github.com/repos/${repo}/releases/latest`).catch(() => null),
      requestJson(`https://api.github.com/repos/${repo}/commits/main`),
      requestJson(`https://raw.githubusercontent.com/${repo}/main/package.json`),
    ]);
    [release, commit] = results;
    version = String(results[2]?.version || "");
  }
  const latestCommit = normalizeCommit(commit?.sha);
  if (!/^\d+\.\d+\.\d+$/.test(version) || !latestCommit || latestCommit.length !== 40) throw new Error("无法确认目标版本及构建提交，请重试");
  const comparison = compareVersions(version, current);
  const differentBuild = installedCommit && !(installedCommit.startsWith(latestCommit) || latestCommit.startsWith(installedCommit));
  const updateKind = comparison > 0 ? "version" : comparison === 0 && differentBuild ? "build" : null;
  const useRelease = channel === "stable" || (release && String(release.tag_name).replace(/^v/, "") === version && updateKind !== "build");
  return {
    currentVersion: current, latestVersion: version, currentCommit: installedCommit, latestCommit, updateKind, hasUpdate: Boolean(updateKind), agentAvailable, channel,
    releaseUrl: useRelease ? release?.html_url || `https://github.com/${repo}/releases` : commit?.html_url || `https://github.com/${repo}/commits/main`,
    releaseNotes: useRelease ? String(release?.body || "稳定版本更新").slice(0, 6000) : `main 分支最新构建：${String(commit?.commit?.message || "").split("\n")[0].slice(0, 300)}`,
    publishedAt: useRelease ? release?.published_at || null : commit?.commit?.committer?.date || null,
  };
}
let queuing = false;
export async function requestWebUpdate(user: string, channel: UpdateChannel = "stable") {
  if (queuing) throw new Error("更新正在排队，请稍候");
  queuing = true;
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const status = await readUpdateStatus();
    if (status.status === "requested" || status.status === "running") throw new Error("更新正在进行中，请稍候");
    const update = await checkForUpdate(channel);
    if (!update.hasUpdate) throw new Error("当前渠道没有更新");
    if (!update.agentAvailable) throw new Error("当前部署未启用网页更新代理");
    const requestedAt = new Date().toISOString();
    const statusTemporary = `${statusFile}.${process.pid}.tmp`;
    await fs.writeFile(statusTemporary, JSON.stringify({ status: "requested", message: `准备更新至 v${update.latestVersion}（${channel === "stable" ? "稳定版" : "测试版"}）`, progress: 1, updatedAt: requestedAt }), { mode: 0o600 });
    await fs.rename(statusTemporary, statusFile);
    const temporary = `${requestFile}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ requestedBy: user, requestedAt, channel, targetCommit: update.latestCommit }), { mode: 0o600 });
      await fs.rename(temporary, requestFile);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      await fs.writeFile(statusTemporary, JSON.stringify({ status: "failed", message: "无法提交更新请求，请检查数据目录权限", progress: 0, updatedAt: requestedAt }), { mode: 0o600 });
      await fs.rename(statusTemporary, statusFile);
      throw error;
    }
    return { accepted: true };
  } finally { queuing = false; }
}
