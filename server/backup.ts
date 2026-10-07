import { randomBytes, randomUUID } from "node:crypto";
import { db, hashToken } from "./db";
import { hydrateProject, syncProjectNodes } from "./domainService";
import type { MihomoConfig, ProxyNode, TargetFormat } from "../src/shared/types";
import { readMihomoConfig } from "../src/shared/schema";
import { validateConfig } from "../src/shared/mihomo";

interface BackupSubscription { id: string; name: string; url: string; format: string; intervalMinutes: number }
interface BackupVersion { label: string; targetFormat: TargetFormat; config: MihomoConfig; createdAt: string }
interface BackupProject { id?: string; name: string; targetFormat: TargetFormat; config: MihomoConfig; subscriptions: BackupSubscription[]; versions: BackupVersion[] }
interface BackupNodeSource { id: string; name: string; kind: string; url?: string; format: string; enabled: boolean; intervalMinutes?: number; userAgent?: string; skipCertVerify?: boolean }
interface BackupManagedNode { id: string; sourceId?: string; config: ProxyNode; enabled: boolean; sortOrder: number; tags: string[]; note?: string }
interface BackupTemplate { id: string; name: string; description: string; targetFormat: TargetFormat; content: unknown[] }
interface BackupProfile { id: string; name: string; targetFormat: TargetFormat; config: MihomoConfig; nodeIds: string[]; sourceIds: string[]; templateId?: string; status: string }
interface BackupPublication { profileId: string; name: string; targetFormat: TargetFormat; content: string; version: number; nodeCount: number; expiresAt?: string; revoked: boolean }
interface UserBackupV1 { format: "ou-yaml-backup"; version: 1; exportedAt: string; username: string; projects: BackupProject[] }
interface UserBackupV2 { format: "ou-yaml-backup"; version: 2; exportedAt: string; username: string; projects: BackupProject[]; nodeSources: BackupNodeSource[]; managedNodes: BackupManagedNode[]; ruleTemplates: BackupTemplate[]; generationProfiles: BackupProfile[]; publications: BackupPublication[] }

function readJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function readFlag(value: unknown) {
  return Number(value) === 1 || value === true;
}

function cleanProxyConfig(value: unknown) {
  const node = (value && typeof value === "object" ? value : readJson<ProxyNode>(value, {} as ProxyNode)) as ProxyNode & { userId?: string; sourceId?: string; enabled?: boolean; sortOrder?: number; tags?: string[]; note?: string; createdAt?: string; updatedAt?: string };
  const { userId: _userId, sourceId: _sourceId, enabled: _enabled, sortOrder: _sortOrder, tags: _tags, note: _note, createdAt: _createdAt, updatedAt: _updatedAt, ...config } = node;
  return config as ProxyNode;
}

function requireUniqueIds(items: { id: string }[], label: string) {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`备份中的${label} ID 重复`);
}

export function exportUserBackup(userId: string, username: string) {
  const projects = db.prepare("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at ASC").all(userId) as Record<string, unknown>[];
  const nodeSources = db.prepare("SELECT * FROM node_sources WHERE user_id = ? ORDER BY created_at ASC").all(userId) as Record<string, unknown>[];
  const managedNodes = db.prepare("SELECT * FROM managed_nodes WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC").all(userId) as Record<string, unknown>[];
  const templates = db.prepare("SELECT * FROM rule_templates WHERE user_id = ? AND is_builtin = 0 ORDER BY created_at ASC").all(userId) as Record<string, unknown>[];
  const profiles = db.prepare("SELECT * FROM generation_profiles WHERE user_id = ? ORDER BY created_at ASC").all(userId) as Record<string, unknown>[];
  const publications = db.prepare("SELECT * FROM generated_subscriptions WHERE user_id = ? ORDER BY created_at ASC").all(userId) as Record<string, unknown>[];
  const backup: UserBackupV2 = {
    format: "ou-yaml-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    username,
    projects: projects.map((project) => {
      const subscriptions = db.prepare("SELECT * FROM subscriptions WHERE project_id = ? ORDER BY created_at ASC").all(project.id) as Record<string, unknown>[];
      const versions = db.prepare("SELECT * FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 50").all(project.id) as Record<string, unknown>[];
      return {
        id: String(project.id),
        name: String(project.name),
        targetFormat: project.target_format === "sing-box" ? "sing-box" : "mihomo",
        config: hydrateProject(project).config,
        subscriptions: subscriptions.map((item) => ({ id: String(item.id), name: String(item.name), url: String(item.url), format: String(item.format), intervalMinutes: Number(item.interval_minutes) })),
        versions: versions.map((item) => ({ label: String(item.label), targetFormat: item.target_format === "sing-box" ? "sing-box" : "mihomo", config: readJson<MihomoConfig>(item.config_json, {} as MihomoConfig), createdAt: String(item.created_at) })),
      };
    }),
    nodeSources: nodeSources.map((row) => ({ id: String(row.id), name: String(row.name), kind: String(row.kind), url: row.url ? String(row.url) : undefined, format: String(row.format), enabled: readFlag(row.enabled), intervalMinutes: Number(row.interval_minutes || 0), userAgent: row.user_agent ? String(row.user_agent) : undefined, skipCertVerify: readFlag(row.skip_cert_verify) })),
    managedNodes: managedNodes.map((row) => ({ id: String(row.id), sourceId: row.source_id ? String(row.source_id) : undefined, config: cleanProxyConfig(row.config_json), enabled: readFlag(row.enabled), sortOrder: Number(row.sort_order || 0), tags: readJson<string[]>(row.tags_json, []), note: row.note ? String(row.note) : undefined })),
    ruleTemplates: templates.map((row) => ({ id: String(row.id), name: String(row.name), description: String(row.description || ""), targetFormat: row.target_format === "sing-box" ? "sing-box" : "mihomo", content: readJson<unknown[]>(row.content_json, []) })),
    generationProfiles: profiles.map((row) => ({ id: String(row.id), name: String(row.name), targetFormat: row.target_format === "sing-box" ? "sing-box" : "mihomo", config: readJson<MihomoConfig>(row.config_json, {} as MihomoConfig), nodeIds: readJson<string[]>(row.node_ids_json, []), sourceIds: readJson<string[]>(row.source_ids_json, []), templateId: row.template_id ? String(row.template_id) : undefined, status: String(row.status) })),
    publications: publications.map((row) => ({ profileId: String(row.profile_id), name: String(row.name), targetFormat: row.target_format === "sing-box" ? "sing-box" : "mihomo", content: String(row.content), version: Number(row.version), nodeCount: Number(row.node_count), expiresAt: row.expires_at ? String(row.expires_at) : undefined, revoked: readFlag(row.revoked) })),
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
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

function validateNode(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("备份中包含无效节点");
  const node = value as Partial<ProxyNode>;
  if (typeof node.id !== "string" || typeof node.name !== "string" || !node.name.trim() || typeof node.type !== "string" || typeof node.server !== "string" || !Number.isInteger(node.port) || Number(node.port) < 1 || Number(node.port) > 65535) throw new Error("备份中包含无效节点");
  return node as ProxyNode;
}

function validateProjects(projects: BackupProject[]) {
  if (projects.length > 100) throw new Error("备份中的项目数量超过限制");
  for (const project of projects) {
    if (!project || typeof project.name !== "string" || project.name.trim().length < 1 || project.name.length > 80 || !["mihomo", "sing-box"].includes(project.targetFormat)) throw new Error("备份中包含无效项目");
    validateConfigValue(project.config);
    if (!Array.isArray(project.subscriptions) || project.subscriptions.length > 100 || !Array.isArray(project.versions) || project.versions.length > 50) throw new Error("备份中的订阅或历史数量超过限制");
    for (const subscription of project.subscriptions) {
      if (!subscription || typeof subscription.id !== "string" || typeof subscription.name !== "string" || !subscription.name.trim() || subscription.name.length > 80 || !["auto", "links", "mihomo", "sing-box"].includes(subscription.format) || !validSubscriptionUrl(subscription.url) || !Number.isInteger(subscription.intervalMinutes) || subscription.intervalMinutes < 0 || subscription.intervalMinutes > 10080) throw new Error("备份中包含无效订阅");
    }
    for (const version of project.versions) {
      if (!version || typeof version.label !== "string" || version.label.length > 80 || !["mihomo", "sing-box"].includes(version.targetFormat)) throw new Error("备份中包含无效历史版本");
      validateConfigValue(version.config);
    }
  }
}

function validateBackup(value: unknown): UserBackupV1 | UserBackupV2 {
  if (!value || typeof value !== "object") throw new Error("备份文件格式无效");
  const candidate = value as { format?: string; version?: number; projects?: BackupProject[] };
  if (candidate.format !== "ou-yaml-backup" || ![1, 2].includes(Number(candidate.version)) || !Array.isArray(candidate.projects)) throw new Error("不是受支持的 OU-YAML 备份");
  const backup = value as UserBackupV1 | UserBackupV2;
  validateProjects(backup.projects);
  if (backup.version === 1) return backup as UserBackupV1;
  if (!Array.isArray(backup.nodeSources) || backup.nodeSources.length > 500 || !Array.isArray(backup.managedNodes) || backup.managedNodes.length > 5000 || !Array.isArray(backup.ruleTemplates) || backup.ruleTemplates.length > 500 || !Array.isArray(backup.generationProfiles) || backup.generationProfiles.length > 500 || !Array.isArray(backup.publications) || backup.publications.length > 2000) throw new Error("备份中的资源数量超过限制");
  requireUniqueIds(backup.nodeSources, "节点来源");
  requireUniqueIds(backup.managedNodes, "节点");
  requireUniqueIds(backup.ruleTemplates, "规则模板");
  requireUniqueIds(backup.generationProfiles, "生成方案");
  for (const source of backup.nodeSources) {
    if (!source || typeof source.id !== "string" || !source.id || typeof source.name !== "string" || !source.name.trim() || source.name.length > 120 || !["manual", "file", "remote-url", "share-links"].includes(source.kind) || !["auto", "links", "mihomo", "sing-box"].includes(source.format) || (source.url && !validSubscriptionUrl(source.url)) || (source.intervalMinutes !== undefined && (!Number.isInteger(source.intervalMinutes) || source.intervalMinutes < 0 || source.intervalMinutes > 10080)) || (source.userAgent !== undefined && (typeof source.userAgent !== "string" || source.userAgent.length > 300)) || typeof source.enabled !== "boolean" || (source.skipCertVerify !== undefined && typeof source.skipCertVerify !== "boolean")) throw new Error("备份中包含无效节点来源");
  }
  for (const node of backup.managedNodes) {
    if (!node || typeof node.id !== "string" || !node.id || (node.sourceId !== undefined && typeof node.sourceId !== "string") || typeof node.enabled !== "boolean" || !Number.isInteger(node.sortOrder) || node.sortOrder < 0 || node.sortOrder > 1_000_000 || (node.note !== undefined && (typeof node.note !== "string" || node.note.length > 500))) throw new Error("备份中包含无效节点");
    validateNode(node.config);
    if (!Array.isArray(node.tags) || node.tags.length > 30 || node.tags.some((tag) => typeof tag !== "string" || tag.length > 40)) throw new Error("备份中包含无效节点标签");
  }
  for (const template of backup.ruleTemplates) if (!template || typeof template.id !== "string" || !template.id || typeof template.name !== "string" || !template.name.trim() || template.name.length > 120 || typeof template.description !== "string" || template.description.length > 500 || !["mihomo", "sing-box"].includes(template.targetFormat) || !Array.isArray(template.content) || template.content.length > 5000) throw new Error("备份中包含无效规则模板");
  for (const profile of backup.generationProfiles) {
    if (!profile || typeof profile.id !== "string" || !profile.id || typeof profile.name !== "string" || !profile.name.trim() || profile.name.length > 120 || !["mihomo", "sing-box"].includes(profile.targetFormat) || !Array.isArray(profile.nodeIds) || profile.nodeIds.length > 5000 || profile.nodeIds.some((id) => typeof id !== "string") || !Array.isArray(profile.sourceIds) || profile.sourceIds.length > 500 || profile.sourceIds.some((id) => typeof id !== "string") || (profile.templateId !== undefined && typeof profile.templateId !== "string") || !["active", "disabled", "error"].includes(profile.status)) throw new Error("备份中包含无效生成方案");
    validateConfigValue(profile.config);
  }
  for (const publication of backup.publications) if (!publication || typeof publication.profileId !== "string" || typeof publication.name !== "string" || !publication.name.trim() || publication.name.length > 120 || !["mihomo", "sing-box"].includes(publication.targetFormat) || typeof publication.content !== "string" || publication.content.length > 10_000_000 || !Number.isInteger(publication.version) || publication.version < 1 || !Number.isInteger(publication.nodeCount) || publication.nodeCount < 0 || (publication.expiresAt !== undefined && !Number.isFinite(new Date(publication.expiresAt).getTime())) || typeof publication.revoked !== "boolean") throw new Error("备份中包含无效发布内容");
  return backup as UserBackupV2;
}

function remapSources(config: MihomoConfig, subscriptionIds: Map<string, string>) {
  const copy = structuredClone(config);
  copy.proxies = copy.proxies.map((node) => {
    if (node.source?.kind !== "subscription") return node;
    if (subscriptionIds.has(node.source.id)) return { ...node, source: { kind: "subscription" as const, id: subscriptionIds.get(node.source.id)! } };
    const { source: _source, ...withoutSource } = node;
    return withoutSource;
  });
  return copy;
}

function remapManagedNodes(config: MihomoConfig, nodeIds: Map<string, string>) {
  const copy = structuredClone(config);
  copy.proxies = copy.proxies.map((node) => ({ ...node, id: nodeIds.get(node.id) || node.id }));
  return copy;
}

export function restoreUserBackup(userId: string, source: string, mode: "merge" | "replace") {
  if (source.length > 10_000_000) throw new Error("备份文件超过 10MB");
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new Error("备份文件不是有效 JSON"); }
  const backup = validateBackup(parsed);
  const backupV2 = backup.version === 2 ? backup : undefined;
  const stamp = new Date().toISOString();
  db.transaction(() => {
    if (mode === "replace") {
      db.prepare("DELETE FROM projects WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM generated_subscriptions WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM generation_profiles WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM rule_templates WHERE user_id = ? AND is_builtin = 0").run(userId);
      db.prepare("DELETE FROM managed_nodes WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM node_sources WHERE user_id = ?").run(userId);
    }

    const sourceIds = new Map<string, string>();
    for (const item of backupV2?.nodeSources || []) {
      const id = randomUUID();
      sourceIds.set(item.id, id);
      db.prepare(`INSERT INTO node_sources (id,user_id,name,kind,url,format,enabled,interval_minutes,user_agent,skip_cert_verify,node_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`)
        .run(id, userId, item.name.slice(0, 120), item.kind, item.url || null, item.format, item.enabled ? 1 : 0, item.intervalMinutes || 0, item.userAgent?.slice(0, 300) || null, item.skipCertVerify ? 1 : 0, stamp, stamp);
    }

    const nodeIds = new Map<string, string>();
    for (const item of backupV2?.managedNodes || []) {
      const id = randomUUID();
      const config = { ...cleanProxyConfig(validateNode(item.config)), id };
      nodeIds.set(item.id, id);
      db.prepare(`INSERT INTO managed_nodes (id,user_id,source_id,name,type,server,port,config_json,raw_config_json,enabled,sort_order,tags_json,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, userId, item.sourceId ? sourceIds.get(item.sourceId) || null : null, config.name, config.type, config.server, config.port, JSON.stringify(config), JSON.stringify(config.extra || {}), item.enabled ? 1 : 0, item.sortOrder, JSON.stringify(item.tags), item.note || null, stamp, stamp);
    }
    for (const id of sourceIds.values()) db.prepare("UPDATE node_sources SET node_count = (SELECT COUNT(*) FROM managed_nodes WHERE source_id = ?) WHERE id = ?").run(id, id);

    for (const project of backup.projects) {
      const projectId = randomUUID();
      const subscriptionIds = new Map(project.subscriptions.map((item) => [item.id, randomUUID()]));
      const config = remapManagedNodes(remapSources(project.config, subscriptionIds), nodeIds);
      db.prepare("INSERT INTO projects (id,user_id,name,config_json,created_at,updated_at,target_format) VALUES (?,?,?,?,?,?,?)")
        .run(projectId, userId, project.name.slice(0, 80), JSON.stringify(config), stamp, stamp, project.targetFormat);
      for (const subscription of project.subscriptions) db.prepare(`INSERT INTO subscriptions (id,project_id,name,url,format,interval_minutes,node_count,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)`)
        .run(subscriptionIds.get(subscription.id), projectId, subscription.name.slice(0, 80), subscription.url.slice(0, 2048), subscription.format, subscription.intervalMinutes, stamp, stamp);
      for (const version of project.versions) {
        const versionConfig = remapManagedNodes(remapSources(version.config, subscriptionIds), nodeIds);
        db.prepare(`INSERT INTO project_versions (id,project_id,label,config_json,target_format,proxy_count,group_count,rule_count,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(randomUUID(), projectId, version.label.slice(0, 80), JSON.stringify(versionConfig), version.targetFormat, versionConfig.proxies.length, versionConfig.proxyGroups.length, versionConfig.rules.length, version.createdAt || stamp);
      }
      const normalized = { ...config, proxies: syncProjectNodes(userId, projectId, config.proxies) };
      db.prepare("UPDATE projects SET config_json = ? WHERE id = ?").run(JSON.stringify(normalized), projectId);
    }

    const templateIds = new Map<string, string>();
    for (const template of backupV2?.ruleTemplates || []) {
      const id = randomUUID();
      templateIds.set(template.id, id);
      db.prepare(`INSERT INTO rule_templates (id,user_id,name,description,target_format,content_json,is_builtin,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)`)
        .run(id, userId, template.name.slice(0, 120), template.description.slice(0, 500), template.targetFormat, JSON.stringify(template.content), stamp, stamp);
    }

    const profileIds = new Map<string, string>();
    for (const profile of backupV2?.generationProfiles || []) {
      const id = randomUUID();
      profileIds.set(profile.id, id);
      const profileConfig = remapManagedNodes(profile.config, nodeIds);
      db.prepare(`INSERT INTO generation_profiles (id,user_id,name,target_format,config_json,node_ids_json,source_ids_json,template_id,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, userId, profile.name.slice(0, 120), profile.targetFormat, JSON.stringify(profileConfig), JSON.stringify(profile.nodeIds.map((nodeId) => nodeIds.get(nodeId)).filter(Boolean)), JSON.stringify(profile.sourceIds.map((sourceId) => sourceIds.get(sourceId)).filter(Boolean)), profile.templateId ? templateIds.get(profile.templateId) || null : null, profile.status === "disabled" ? "disabled" : "active", stamp, stamp);
    }

    for (const publication of backupV2?.publications || []) {
      const profileId = profileIds.get(publication.profileId);
      if (!profileId) continue;
      db.prepare(`INSERT INTO generated_subscriptions (id,profile_id,user_id,name,target_format,token_hash,content,version,node_count,expires_at,revoked,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`)
        .run(randomUUID(), profileId, userId, publication.name.slice(0, 120), publication.targetFormat, hashToken(randomBytes(32).toString("base64url")), publication.content, publication.version, publication.nodeCount, publication.expiresAt || null, stamp, stamp);
    }
  })();
  return { projects: backup.projects.length };
}
