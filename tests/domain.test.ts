import assert from "node:assert/strict";
import test from "node:test";
import type { MihomoConfig } from "../src/shared/types";
import { serializeShareLink } from "../src/shared/links";
import { previewExport } from "../src/shared/exportConfig";
import YAML from "yaml";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ou-yaml-domain-test-"));
const { db } = await import("../server/db");
const domain = await import("../server/domainService");
const { exportUserBackup, restoreUserBackup } = await import("../server/backup");

const userId = randomUUID();
const projectId = randomUUID();
const stamp = new Date().toISOString();
const config: MihomoConfig = {
  version: 1,
  mixedPort: 7890,
  allowLan: false,
  mode: "rule",
  logLevel: "info",
  ipv6: false,
  externalController: "127.0.0.1:9090",
  proxies: [{ id: "legacy-node", name: "香港线路", type: "ss", server: "example.com", port: 443, extra: {} }],
  proxyGroups: [],
  rules: [],
  extra: {},
};

db.prepare("INSERT INTO users (id, username, password_hash, is_admin, is_disabled, created_at) VALUES (?, ?, ?, 0, 0, ?)").run(userId, `test-${userId.slice(0, 8)}`, "hash", stamp);
db.prepare("INSERT INTO projects (id, user_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, userId, "旧项目", JSON.stringify(config), stamp, stamp);

test("迁移旧项目节点到统一节点库并建立项目绑定", () => {
  assert.equal(domain.migrateLegacyProjects(userId), 1);
  assert.equal(domain.migrateLegacyProjects(userId), 0);
  const sources = domain.listNodeSources(userId);
  const nodes = domain.listManagedNodes(userId);
  assert.equal(sources.length, 0);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, "香港线路");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM project_nodes WHERE project_id = ?").get(projectId) as { count: number }).count, 1);
  assert.equal(domain.listManagedNodes(randomUUID()).length, 0);
});

test("生成配置发布后可读取并支持撤销", () => {
  const profile = domain.createProfile(userId, { name: "发布配置", targetFormat: "mihomo", config, nodeIds: ["legacy-node"] });
  assert.ok(profile);
  const published = domain.publishSubscription(userId, profile!.id, "测试订阅", "mihomo", "mixed-port: 7890\n", 1);
  assert.ok(published.token);
  assert.equal(domain.readPublicSubscription(published.token)?.content, "mixed-port: 7890\n");
  assert.equal(domain.readPublicSubscription(published.id), undefined);
  assert.equal(domain.revokePublishedSubscription(userId, published.id), true);
  assert.equal(domain.readPublicSubscription(published.token), undefined);
});

test("过期订阅不可访问", () => {
  const profile = domain.listProfiles(userId)[0];
  const published = domain.publishSubscription(userId, profile.id, "过期订阅", "mihomo", "rules: []\n", 0, new Date(Date.now() - 1000).toISOString());
  assert.equal(domain.readPublicSubscription(published.token), undefined);
});

test("订阅 Token 轮换会立即废止旧地址", () => {
  const profile = domain.listProfiles(userId)[0];
  const published = domain.publishSubscription(userId, profile.id, "轮换订阅", "mihomo", "rules: []\n", 0);
  const rotated = domain.rotatePublishedSubscription(userId, published.id);
  assert.ok(rotated?.token);
  assert.equal(domain.readPublicSubscription(published.token), undefined);
  assert.equal(domain.readPublicSubscription(rotated!.token)?.content, "rules: []\n");
});

test("节点池排序会持久化并保持用户隔离", () => {
  const first = domain.createManagedNode(userId, { name: "排序一", type: "vless", server: "one.example.com", port: 443, uuid: "uuid-one", extra: {} });
  const second = domain.createManagedNode(userId, { name: "排序二", type: "vless", server: "two.example.com", port: 443, uuid: "uuid-two", extra: {} });
  const reordered = domain.reorderManagedNodes(userId, [second.id, first.id]);
  assert.deepEqual(reordered.filter(node => [first.id, second.id].includes(node.id)).map(node => node.id), [second.id, first.id]);
  assert.equal(reordered.find(node => node.id === first.id)?.uuid, "uuid-one");
  assert.throws(() => domain.reorderManagedNodes(randomUUID(), [first.id]), /无权操作/);
});

test("节点编辑不会丢失协议字段", () => {
  const node = domain.createManagedNode(userId, { name: "待编辑", type: "vless", server: "edit.example.com", port: 443, uuid: "keep-me", tls: true, sni: "sni.example.com", extra: {} });
  const updated = domain.updateManagedNode(userId, node.id, { ...node, name: "已编辑" });
  assert.equal(updated?.name, "已编辑");
  assert.equal(updated?.uuid, "keep-me");
  assert.equal(updated?.tls, true);
  assert.equal(updated?.sni, "sni.example.com");
});

test("远程来源替换节点时保留已匹配节点的顺序和元数据", () => {
  const source = domain.createNodeSource(userId, { name: "远程来源", kind: "remote-url", url: "https://nodes.example.com/sub", format: "links" });
  const first = domain.createManagedNode(userId, { name: "来源一", type: "vless", server: "one.example.com", port: 443, uuid: "one", sourceId: source.id, tags: ["保留"], note: "手动备注", extra: {} });
  const second = domain.createManagedNode(userId, { name: "来源二", type: "vless", server: "two.example.com", port: 443, uuid: "two", sourceId: source.id, extra: {} });
  domain.reorderManagedNodes(userId, [second.id, first.id]);
  domain.syncProjectNodes(userId, projectId, [{ ...second, name: "项目中的来源二" }]);
  const result = domain.replaceManagedNodesForSource(userId, source.id, [
    { id: randomUUID(), name: "更新二", type: "vless", server: "two.example.com", port: 443, uuid: "two", extra: {} },
    { id: randomUUID(), name: "新节点", type: "vless", server: "three.example.com", port: 443, uuid: "three", extra: {} },
  ]);
  assert.deepEqual(result.nodes.map((node) => node.name), ["更新二", "新节点"]);
  assert.equal(result.nodes[0].id, second.id);
  assert.equal(result.nodes[0].tags.length, 0);
  assert.equal(result.source.nodeCount, 2);
  assert.equal(domain.readProjectNodes(userId, projectId)[0].id, second.id);
  assert.equal(domain.readProjectNodes(userId, projectId)[0].name, "项目中的来源二");
});

test("生成配置拒绝跨用户节点、来源和模板引用", () => {
  const foreignUserId = randomUUID();
  const foreignStamp = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, password_hash, is_admin, is_disabled, created_at) VALUES (?, ?, ?, 0, 0, ?)")
    .run(foreignUserId, `foreign-${foreignUserId.slice(0, 8)}`, "hash", foreignStamp);
  const foreignNode = domain.createManagedNode(foreignUserId, { name: "他人的节点", type: "vless", server: "foreign.example.com", port: 443, uuid: "foreign", extra: {} });
  const foreignSource = domain.createNodeSource(foreignUserId, { name: "他人的来源", kind: "share-links", format: "links" });
  const foreignTemplate = domain.createRuleTemplate(foreignUserId, { name: "他人的模板", targetFormat: "mihomo", content: [] });
  assert.throws(() => domain.createProfile(userId, { name: "跨用户节点", targetFormat: "mihomo", config, nodeIds: [foreignNode.id] }), /无权使用的节点/);
  assert.throws(() => domain.createProfile(userId, { name: "隐藏跨用户节点", targetFormat: "mihomo", config: { ...config, proxies: [{ ...config.proxies[0], id: foreignNode.id }] } }), /无权使用的节点/);
  assert.throws(() => domain.createProfile(userId, { name: "跨用户来源", targetFormat: "mihomo", config, sourceIds: [foreignSource.id] }), /无权使用的节点来源/);
  assert.throws(() => domain.createProfile(userId, { name: "跨用户模板", targetFormat: "mihomo", config, templateId: foreignTemplate.id }), /规则模板不存在/);
});

test("恢复备份会清理悬空订阅来源引用", () => {
  const backup = {
    format: "ou-yaml-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    username: "backup-test",
    projects: [{
      name: "悬空来源备份",
      targetFormat: "mihomo",
      config: { ...config, proxies: [{ ...config.proxies[0], source: { kind: "subscription", id: "missing-subscription" } }] },
      subscriptions: [],
      versions: [],
    }],
  };
  assert.deepEqual(restoreUserBackup(userId, JSON.stringify(backup), "merge"), { projects: 1 });
  const row = db.prepare("SELECT config_json FROM projects WHERE user_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1").get(userId, "悬空来源备份") as { config_json: string };
  const restored = JSON.parse(row.config_json) as MihomoConfig;
  assert.equal(restored.proxies[0].source, undefined);
});

test("备份 v2 覆盖节点库、来源、模板和发布资源", () => {
  const backup = JSON.parse(exportUserBackup(userId, "backup-test")) as Record<string, unknown>;
  assert.equal(backup.version, 2);
  assert.ok(Array.isArray(backup.nodeSources));
  assert.ok(Array.isArray(backup.managedNodes));
  assert.ok(Array.isArray(backup.ruleTemplates));
  assert.ok(Array.isArray(backup.generationProfiles));
  assert.ok(Array.isArray(backup.publications));
  const managedNodes = backup.managedNodes as { config: Record<string, unknown> }[];
  assert.equal(managedNodes.some((item) => ["tags", "note", "enabled", "sourceId"].some((key) => key in item.config)), false);
});

test("项目节点绑定保留别名并让未覆写字段跟随节点库更新", () => {
  const node = domain.createManagedNode(userId, { name: "节点库名称", type: "vless", server: "before.example.com", port: 443, uuid: "binding-node", tls: true, sni: "base.example.com", extra: {} });
  domain.syncProjectNodes(userId, projectId, [{ ...node, name: "项目专属别名", sni: "override.example.com" }]);
  const beforeUpdate = String((db.prepare("SELECT updated_at FROM projects WHERE id = ?").get(projectId) as { updated_at: string }).updated_at);
  domain.updateManagedNode(userId, node.id, { ...node, server: "after.example.com", sni: "new-base.example.com" });
  const bound = domain.readProjectNodes(userId, projectId).find((item) => item.id === node.id);
  assert.equal(bound?.name, "项目专属别名");
  assert.equal(bound?.server, "after.example.com");
  assert.equal(bound?.sni, "override.example.com");
  assert.ok(String((db.prepare("SELECT updated_at FROM projects WHERE id = ?").get(projectId) as { updated_at: string }).updated_at) > beforeUpdate);
});

test("节点库默认名称更新会同步项目代理组和规则引用", () => {
  const isolatedProjectId = randomUUID();
  const node = domain.createManagedNode(userId, { name: "东京节点", type: "vless", server: "tokyo.example.com", port: 443, uuid: "rename-node", extra: {} });
  const isolatedConfig: MihomoConfig = {
    ...config,
    proxies: [{ ...node, name: "东京节点" }],
    proxyGroups: [{ id: randomUUID(), name: "默认代理", type: "select", proxies: ["东京节点"], extra: {} }],
    rules: [{ id: randomUUID(), type: "MATCH", value: "", target: "默认代理", options: [], enabled: true }],
  };
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO projects (id,user_id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(isolatedProjectId, userId, "节点改名同步", JSON.stringify(isolatedConfig), createdAt, createdAt);
  domain.syncProjectNodes(userId, isolatedProjectId, isolatedConfig.proxies);

  domain.updateManagedNode(userId, node.id, { ...node, name: "🇯🇵 东京节点" });
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(isolatedProjectId) as Record<string, unknown>;
  const hydrated = domain.hydrateProject(row);
  assert.equal(hydrated.config.proxies[0].name, "🇯🇵 东京节点");
  assert.deepEqual(hydrated.config.proxyGroups[0].proxies, ["🇯🇵 东京节点"]);
  assert.equal(hydrated.config.rules[0].target, "默认代理");
});

test("国旗改名同步默认和自定义别名到项目与生成配置，且不触发发布", () => {
  const isolatedProjectId = randomUUID();
  const node = domain.createManagedNode(userId, { name: "国旗测试东京", type: "vless", server: "flagged.example.com", port: 443, uuid: "flag-sync-node", extra: {} });
  const customAlias = "专属 · 国旗测试东京线路";
  const projectConfig: MihomoConfig = {
    ...config,
    proxies: [{ ...node, name: "国旗测试东京" }],
    proxyGroups: [{ id: randomUUID(), name: "国旗测试选择", type: "select", proxies: ["国旗测试东京"], extra: {} }],
    rules: [{ id: randomUUID(), type: "MATCH", value: "", target: "国旗测试选择", options: [], enabled: true }],
  };
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO projects (id,user_id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(isolatedProjectId, userId, "国旗名称同步", JSON.stringify(projectConfig), createdAt, createdAt);
  domain.syncProjectNodes(userId, isolatedProjectId, projectConfig.proxies);
  const profileConfig: MihomoConfig = {
    ...projectConfig,
    proxies: [{ ...node, name: customAlias }],
    proxyGroups: [{ ...projectConfig.proxyGroups[0], proxies: [customAlias] }],
  };
  const profile = domain.createProfile(userId, { name: "国旗生成方案", targetFormat: "mihomo", config: profileConfig, nodeIds: [node.id] })!;
  const published = domain.publishSubscription(userId, profile.id, "原订阅", "mihomo", "published before flag change", 1);

  const updated = domain.updateManagedNode(userId, node.id, { ...node, name: "🇯🇵 国旗测试东京" })!;
  const project = domain.hydrateProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(isolatedProjectId) as Record<string, unknown>);
  const savedProfile = domain.getProfile(userId, profile.id)!;
  assert.deepEqual(project.config.proxies.map((item) => item.name), ["🇯🇵 国旗测试东京"]);
  assert.deepEqual(project.config.proxyGroups[0].proxies, ["🇯🇵 国旗测试东京"]);
  assert.deepEqual(savedProfile.config.proxies.map((item) => item.name), ["🇯🇵 专属 · 国旗测试东京线路"]);
  assert.deepEqual(savedProfile.config.proxyGroups[0].proxies, ["🇯🇵 专属 · 国旗测试东京线路"]);

  const mihomo = previewExport(savedProfile.config, "mihomo");
  assert.equal(mihomo.issues.some((issue) => issue.level === "error"), false);
  assert.deepEqual((YAML.parse(mihomo.content) as { proxies: { name: string }[] }).proxies.map((item) => item.name), ["🇯🇵 专属 · 国旗测试东京线路"]);
  const singBox = previewExport(savedProfile.config, "sing-box");
  assert.equal(singBox.issues.some((issue) => issue.level === "error"), false);
  assert.deepEqual((JSON.parse(singBox.content) as { outbounds: { tag: string }[] }).outbounds[0].tag, "🇯🇵 专属 · 国旗测试东京线路");
  assert.match(serializeShareLink({ ...updated, name: "🇯🇵 专属 · 国旗测试东京线路" })!, /%F0%9F%87%AF%F0%9F%87%B5/);

  const timestamp = updated.updatedAt;
  domain.updateManagedNode(userId, updated.id, updated);
  assert.equal(domain.getManagedNode(userId, updated.id)?.updatedAt, timestamp);
  assert.equal(domain.readPublicSubscription(published.token!)?.content, "published before flag change");
  assert.equal(domain.listPublishedSubscriptions(userId).find((item) => item.id === published.id)?.version, 1);
});

test("国旗名称用于复制的协议分享链接", async () => {
  const { parseShareLink } = await import("../src/shared/links");
  const node = domain.createManagedNode(userId, { name: "🇯🇵 专属线路", type: "vless", server: "share.example.com", port: 443, uuid: "share-flag-id", extra: {} });
  domain.updateManagedNode(userId, node.id, { ...node, name: "🇸🇬 专属线路" });
  const link = serializeShareLink(domain.getManagedNode(userId, node.id)!)!;
  assert.equal(parseShareLink(link).name, "🇸🇬 专属线路");
});

test("国旗别名冲突会拒绝并回滚节点、项目和生成配置", () => {
  const isolatedProjectId = randomUUID();
  const node = domain.createManagedNode(userId, { name: "国旗冲突测试", type: "vless", server: "collision.example.com", port: 443, uuid: "collision-node", extra: {} });
  const other = domain.createManagedNode(userId, { name: "冲突目标邻居", type: "vless", server: "other.example.com", port: 443, uuid: "collision-other", extra: {} });
  const conflictingAlias = "🇯🇵 国旗冲突测试";
  const projectConfig: MihomoConfig = {
    ...config,
    proxies: [{ ...node, name: "国旗冲突测试" }, { ...other, name: conflictingAlias }],
    proxyGroups: [{ id: randomUUID(), name: "冲突组", type: "select", proxies: ["国旗冲突测试", conflictingAlias], extra: {} }],
    rules: [],
  };
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO projects (id,user_id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(isolatedProjectId, userId, "国旗别名冲突", JSON.stringify(projectConfig), createdAt, createdAt);
  domain.syncProjectNodes(userId, isolatedProjectId, projectConfig.proxies);
  const profile = domain.createProfile(userId, { name: "冲突方案", targetFormat: "mihomo", config: projectConfig, nodeIds: [node.id, other.id] })!;

  assert.throws(() => domain.updateManagedNode(userId, node.id, { ...node, name: conflictingAlias }), /别名/);
  assert.equal(domain.getManagedNode(userId, node.id)?.name, "国旗冲突测试");
  assert.deepEqual(domain.readProjectNodes(userId, isolatedProjectId).map((item) => item.name), ["国旗冲突测试", conflictingAlias]);
  assert.deepEqual(domain.getProfile(userId, profile.id)?.config.proxies.map((item) => item.name), ["国旗冲突测试", conflictingAlias]);
});

test("删除项目最后一个节点会同步清理引用且不会被旧配置重新迁回", () => {
  const isolatedProjectId = randomUUID();
  const node = domain.createManagedNode(userId, { name: "待删除节点", type: "vless", server: "delete.example.com", port: 443, uuid: "delete-node", extra: {} });
  const isolatedConfig: MihomoConfig = {
    ...config,
    proxies: [{ id: node.id, name: "项目节点别名", type: "vless", server: "delete.example.com", port: 443, uuid: "delete-node", extra: {} }],
    proxyGroups: [{ id: randomUUID(), name: "删除测试组", type: "select", proxies: ["项目节点别名"], extra: {} }],
    rules: [{ id: randomUUID(), type: "MATCH", value: "", target: "项目节点别名", options: [], enabled: true }],
  };
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO projects (id,user_id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(isolatedProjectId, userId, "删除引用测试", JSON.stringify(isolatedConfig), createdAt, createdAt);
  domain.syncProjectNodes(userId, isolatedProjectId, isolatedConfig.proxies);

  assert.equal(domain.deleteManagedNode(userId, node.id), true);
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(isolatedProjectId) as Record<string, unknown>;
  const hydrated = domain.hydrateProject(row);
  assert.equal(hydrated.config.proxies.length, 0);
  assert.deepEqual(hydrated.config.proxyGroups[0].proxies, []);
  assert.equal(hydrated.config.rules[0].target, "DIRECT");
  assert.equal(domain.listManagedNodes(userId).some((item) => item.id === node.id), false);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM project_nodes WHERE project_id = ?").get(isolatedProjectId) as { count: number }).count, 0);
});

test("节点批量操作支持启停、标签与名称替换", () => {
  const first = domain.createManagedNode(userId, { name: "HK-旧名称", type: "ss", server: "batch-one.example.com", port: 443, extra: {}, tags: ["旧标签"] });
  const second = domain.createManagedNode(userId, { name: "JP-旧名称", type: "ss", server: "batch-two.example.com", port: 443, extra: {} });
  const updated = domain.batchUpdateManagedNodes(userId, [first.id, second.id], { enabled: false, addTags: ["流媒体"], removeTags: ["旧标签"], prefix: "优选-", find: "旧名称", replace: "节点" });
  const selected = updated.filter((item) => [first.id, second.id].includes(item.id));
  assert.equal(selected.every((item) => item.enabled === false), true);
  assert.equal(selected.every((item) => item.tags.includes("流媒体")), true);
  assert.equal(selected.some((item) => item.tags.includes("旧标签")), false);
  assert.deepEqual(selected.map((item) => item.name).sort(), ["优选-HK-节点", "优选-JP-节点"].sort());
});

test("Generation Profile 可更新且公开订阅保持原 Token 增量升级", () => {
  const node = domain.listManagedNodes(userId)[0];
  const profileConfig = { ...config, proxies: [{ ...config.proxies[0], id: node.id }] };
  const profile = domain.createProfile(userId, { name: "稳定方案", targetFormat: "mihomo", config: profileConfig, nodeIds: [node.id] });
  const updatedProfile = domain.updateProfile(userId, profile!.id, { name: "稳定方案 v2", targetFormat: "mihomo", config: profileConfig, nodeIds: [node.id] });
  assert.equal(updatedProfile?.name, "稳定方案 v2");
  const published = domain.publishSubscription(userId, profile!.id, "稳定订阅", "mihomo", "version: 1\n", 1);
  const updated = domain.updatePublishedSubscription(userId, published.id, { name: "稳定订阅", content: "version: 2\n", nodeCount: 1 });
  assert.equal(updated?.version, published.version + 1);
  assert.equal(domain.readPublicSubscription(published.token)?.content, "version: 2\n");
  assert.throws(() => domain.updatePublishedSubscription(userId, published.id, { name: "数量越界", content: "x", nodeCount: 2 }), /节点数量无效/);
  domain.updateProfile(userId, profile!.id, { name: "稳定方案 v2", targetFormat: "sing-box", config: profileConfig, nodeIds: [node.id] });
  assert.throws(() => domain.updatePublishedSubscription(userId, published.id, { name: "格式变化", content: "{}", nodeCount: 1 }), /输出格式已改变/);
  domain.updateProfile(userId, profile!.id, { name: "稳定方案 v2", targetFormat: "mihomo", config: profileConfig, nodeIds: [node.id] });
});

test("Profile 更新拒绝引用其他用户节点", () => {
  const profile = domain.listProfiles(userId)[0];
  const foreignUser = db.prepare("SELECT id FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 1").get(userId) as { id: string };
  const foreignNode = domain.listManagedNodes(foreignUser.id)[0];
  assert.ok(foreignNode);
  assert.throws(() => domain.updateProfile(userId, profile.id, { name: profile.name, targetFormat: profile.targetFormat, config: { ...profile.config, proxies: [{ ...profile.config.proxies[0], id: foreignNode.id }] }, nodeIds: [foreignNode.id] }), /无权使用的节点/);
});

test("完整备份恢复后资源引用使用新 ID 且发布链接默认撤销", () => {
  const targetUserId = randomUUID();
  db.prepare("INSERT INTO users (id, username, password_hash, is_admin, is_disabled, created_at) VALUES (?, ?, ?, 0, 0, ?)")
    .run(targetUserId, `restore-${targetUserId.slice(0, 8)}`, "hash", new Date().toISOString());
  const sourceBackup = exportUserBackup(userId, "backup-source");
  assert.deepEqual(restoreUserBackup(targetUserId, sourceBackup, "replace"), { projects: JSON.parse(sourceBackup).projects.length });
  const restoredNodes = domain.listManagedNodes(targetUserId);
  const restoredProfiles = domain.listProfiles(targetUserId);
  const restoredPublications = domain.listPublishedSubscriptions(targetUserId);
  const restoredNodeIds = new Set(restoredNodes.map((node) => node.id));
  assert.ok(restoredNodes.length > 0);
  assert.ok(restoredProfiles.length > 0);
  assert.equal(restoredProfiles.flatMap((profile) => profile.nodeIds).every((id) => restoredNodeIds.has(id)), true);
  assert.equal(restoredProfiles.flatMap((profile) => profile.config.proxies).filter((node) => restoredNodeIds.has(node.id)).length > 0, true);
  assert.equal(restoredPublications.every((item) => item.revoked), true);
});
