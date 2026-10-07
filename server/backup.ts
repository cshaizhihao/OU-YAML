import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { MihomoConfig, TargetFormat } from "../src/shared/types";
import { readMihomoConfig } from "../src/shared/schema";
import { validateConfig } from "../src/shared/mihomo";

interface BackupSubscription { id: string; name: string; url: string; format: string; intervalMinutes: number }
interface BackupVersion { label: string; targetFormat: TargetFormat; config: MihomoConfig; createdAt: string }
interface BackupProject { name: string; targetFormat: TargetFormat; config: MihomoConfig; subscriptions: BackupSubscription[]; versions: BackupVersion[] }
interface UserBackup { format: "ou-yaml-backup"; version: 1; exportedAt: string; username: string; projects: BackupProject[] }

export function exportUserBackup(userId: string, username: string) {
  const projects = db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC").all(userId) as Record<string, unknown>[];
  const backup: UserBackup = {
    format: "ou-yaml-backup", version: 1, exportedAt: new Date().toISOString(), username,
    projects: projects.map((project) => {
      const subscriptions = db.prepare("SELECT * FROM subscriptions WHERE project_id = ? ORDER BY created_at ASC").all(project.id) as Record<string, unknown>[];
      const versions = db.prepare("SELECT * FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 50").all(project.id) as Record<string, unknown>[];
      return {
        name: String(project.name), targetFormat: project.target_format === "sing-box" ? "sing-box" : "mihomo",
        config: JSON.parse(String(project.config_json)) as MihomoConfig,
        subscriptions: subscriptions.map((item) => ({ id: String(item.id), name: String(item.name), url: String(item.url), format: String(item.format), intervalMinutes: Number(item.interval_minutes) })),
        versions: versions.map((item) => ({ label: String(item.label), targetFormat: item.target_format === "sing-box" ? "sing-box" : "mihomo", config: JSON.parse(String(item.config_json)) as MihomoConfig, createdAt: String(item.created_at) })),
      };
    }),
  };
  return JSON.stringify(backup, null, 2) + "\n";
}

function validateBackup(value: unknown): UserBackup {
  if (!value || typeof value !== "object") throw new Error("备份文件格式无效");
  const backup = value as Partial<UserBackup>;
  if (backup.format !== "ou-yaml-backup" || backup.version !== 1 || !Array.isArray(backup.projects)) throw new Error("不是受支持的 OU-YAML 备份");
  if (backup.projects.length > 100) throw new Error("备份中的项目数量超过限制");
  for (const project of backup.projects) {
    if (!project || typeof project.name !== "string" || project.name.trim().length < 1 || project.name.length > 80 || !["mihomo", "sing-box"].includes(project.targetFormat)) throw new Error("备份中包含无效项目");
    validateConfigValue(project.config);
    if (!Array.isArray(project.subscriptions) || project.subscriptions.length > 100 || !Array.isArray(project.versions) || project.versions.length > 50) throw new Error("备份中的订阅或历史数量超过限制");
    for (const subscription of project.subscriptions) {
      if (!subscription || typeof subscription.id !== "string" || typeof subscription.name !== "string" || subscription.name.trim().length < 1 || subscription.name.length > 80 || !["auto", "links", "mihomo", "sing-box"].includes(subscription.format) || !validSubscriptionUrl(subscription.url) || !Number.isInteger(subscription.intervalMinutes) || subscription.intervalMinutes < 0 || subscription.intervalMinutes > 10080) throw new Error("备份中包含无效订阅");
    }
    for (const version of project.versions) {
      if (!version || typeof version.label !== "string" || version.label.length > 80 || !["mihomo", "sing-box"].includes(version.targetFormat)) throw new Error("备份中包含无效历史版本");
      validateConfigValue(version.config);
    }
  }
  return backup as UserBackup;
}

function validSubscriptionUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function validateConfigValue(value: unknown) {
  const parsed = readMihomoConfig(value);
  if (!parsed.success || validateConfig(parsed.data as MihomoConfig).some((issue) => issue.level === "error")) throw new Error("备份中包含无效配置");
  return parsed.data as MihomoConfig;
}

function remapSources(config: MihomoConfig, subscriptionIds: Map<string, string>) {
  const copy = structuredClone(config);
  copy.proxies = copy.proxies.map((node) => {
    if (node.source?.kind !== "subscription") return node;
    if (subscriptionIds.has(node.source.id)) return { ...node, source: { kind: "subscription", id: subscriptionIds.get(node.source.id)! } };
    const { source: _source, ...withoutSource } = node;
    return withoutSource;
  });
  return copy;
}

export function restoreUserBackup(userId: string, source: string, mode: "merge" | "replace") {
  if (source.length > 10_000_000) throw new Error("备份文件超过 10MB");
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error("备份文件不是有效 JSON"); }
  const backup = validateBackup(parsed);
  const now = new Date().toISOString();
  db.transaction(() => {
    if (mode === "replace") db.prepare("DELETE FROM projects WHERE user_id = ?").run(userId);
    for (const project of backup.projects) {
      const projectId = randomUUID();
      const subscriptionIds = new Map(project.subscriptions.map((item) => [item.id, randomUUID()]));
      const config = remapSources(project.config, subscriptionIds);
      db.prepare("INSERT INTO projects (id, user_id, name, config_json, created_at, updated_at, target_format) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(projectId, userId, project.name.slice(0, 80), JSON.stringify(config), now, now, project.targetFormat === "sing-box" ? "sing-box" : "mihomo");
      for (const subscription of project.subscriptions) {
        db.prepare(`INSERT INTO subscriptions (id, project_id, name, url, format, interval_minutes, node_count, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .run(subscriptionIds.get(subscription.id), projectId, subscription.name.slice(0, 80), subscription.url.slice(0, 2048), subscription.format, Math.max(0, Math.min(10080, Number(subscription.intervalMinutes) || 0)), now, now);
      }
      for (const version of project.versions) {
        const versionConfig = remapSources(version.config, subscriptionIds);
        db.prepare(`INSERT INTO project_versions (id, project_id, label, config_json, target_format, proxy_count, group_count, rule_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(randomUUID(), projectId, version.label.slice(0, 80), JSON.stringify(versionConfig), version.targetFormat === "sing-box" ? "sing-box" : "mihomo", versionConfig.proxies.length, versionConfig.proxyGroups.length, versionConfig.rules.length, version.createdAt || now);
      }
    }
  })();
  return { projects: backup.projects.length };
}
