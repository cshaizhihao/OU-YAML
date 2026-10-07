import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createEmptyConfig } from "../src/shared/types";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ou-publish-"));
const { db } = await import("../server/db");
const domain = await import("../server/domainService");
const publication = await import("../server/publicationService");
const userId = randomUUID();
const projectId = randomUUID();
const stamp = new Date().toISOString();
db.prepare("INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)").run(userId, userId, "hash", stamp);
db.prepare("INSERT INTO projects (id,user_id,name,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(projectId, userId, "快捷测试", JSON.stringify(createEmptyConfig()), stamp, stamp);
const source = domain.createNodeSource(userId, { name: "来源", kind: "file" });
let node = domain.createManagedNode(userId, { name: "节点一", type: "ss", server: "1.1.1.1", port: 443, password: "test", cipher: "aes-128-gcm", sourceId: source.id, extra: {} });

test("三步发布创建项目绑定，重复发布保持地址并隔离用户", async () => {
  const result = await publication.quickPublish(userId, projectId, { nodeIds: [node.id], preset: "simple", autoUpdate: true, includeNewNodes: true, updatedAt: stamp });
  assert.ok(result.token);
  assert.equal(publication.readSubscriptionToken(userId, result.id), result.token);
  assert.throws(() => publication.readSubscriptionToken("other", result.id), /不存在/);
  const project = db.prepare("SELECT updated_at FROM projects WHERE id = ?").get(projectId) as { updated_at: string };
  const expiry = new Date(Date.now() + 3600_000).toISOString();
  db.prepare("UPDATE generated_subscriptions SET expires_at = ? WHERE id = ?").run(expiry, result.id);
  const second = await publication.quickPublish(userId, projectId, { nodeIds: [node.id], preset: "current", autoUpdate: true, includeNewNodes: true, updatedAt: project.updated_at });
  assert.equal(result.token, second.token);
  assert.equal(result.id, second.id);
  assert.equal(second.version, result.version);
  assert.equal(second.expiresAt, expiry);
  await assert.rejects(publication.quickPublish(userId, projectId, { nodeIds: [node.id], preset: "simple", autoUpdate: true, includeNewNodes: true, updatedAt: stamp }), /变化/);
});

test("自动同步接收新增节点、保持原地址且不重复增加版本", async () => {
  const profile = domain.listProfiles(userId)[0];
  const published = domain.listPublishedSubscriptions(userId)[0];
  const token = publication.readSubscriptionToken(userId, published.id);
  node = domain.updateManagedNode(userId, node.id, { ...node, port: 8443 })!;
  domain.createManagedNode(userId, { name: "节点二", type: "ss", server: "8.8.8.8", port: 443, password: "test", cipher: "aes-128-gcm", sourceId: source.id, extra: {} });
  await publication.syncProfile(userId, profile.id);
  const updated = domain.readPublicSubscription(token)!;
  assert.match(updated.content, /8443/);
  assert.match(updated.content, /节点二/);
  assert.equal(domain.listPublishedSubscriptions(userId)[0].nodeCount, 2);
  await publication.syncProfile(userId, profile.id);
  assert.equal(domain.readPublicSubscription(token)!.version, updated.version);
});

test("校验失败保留上次订阅内容并记录错误", async () => {
  const profile = domain.listProfiles(userId)[0];
  const published = domain.listPublishedSubscriptions(userId)[0];
  const token = publication.readSubscriptionToken(userId, published.id);
  const previous = domain.readPublicSubscription(token)!.content;
  const binary = path.join(process.env.DATA_DIR!, "invalid-kernel");
  writeFileSync(binary, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  process.env.MIHOMO_BINARY = binary;
  try {
    domain.updateManagedNode(userId, node.id, { ...node, port: 9443 });
    await assert.rejects(publication.syncProfile(userId, profile.id), /内核校验失败/);
    assert.equal(domain.readPublicSubscription(token)!.content, previous);
    assert.match(domain.getProfile(userId, profile.id)!.lastSyncError!, /内核校验失败/);
  } finally { delete process.env.MIHOMO_BINARY; }
});

test("来源刷新保留自定义国旗名称，并按原始名字匹配变更地址", () => {
  domain.updateManagedNode(userId, node.id, { ...node, name: "🇦🇺 自定义名称" });
  const imported = [{ ...node, name: "节点一", server: "9.9.9.9" }];
  domain.replaceManagedNodesForSource(userId, source.id, imported);
  const updated = domain.getManagedNode(userId, node.id)!;
  assert.equal(updated.name, "🇦🇺 自定义名称");
  assert.equal(updated.server, "9.9.9.9");
});

test("停用再启用节点不会永久丢失选择和组关系", async () => {
  const profile = domain.listProfiles(userId)[0];
  const enabledNode = domain.getManagedNode(userId, node.id)!;
  const other = domain.createManagedNode(userId, { ...enabledNode, id: undefined, name: "保底节点", server: "8.8.4.4" });
  await publication.syncProfile(userId, profile.id);
  domain.updateManagedNode(userId, node.id, { ...enabledNode, enabled: false });
  await publication.syncProfile(userId, profile.id);
  assert.ok(domain.getProfile(userId, profile.id)!.nodeIds.includes(node.id));
  const token = publication.readSubscriptionToken(userId, domain.listPublishedSubscriptions(userId)[0].id);
  assert.doesNotMatch(domain.readPublicSubscription(token)!.content, /9\.9\.9\.9/);
  domain.updateManagedNode(userId, node.id, { ...enabledNode, enabled: true });
  await publication.syncProfile(userId, profile.id);
  assert.match(domain.readPublicSubscription(token)!.content, /9\.9\.9\.9/);
  assert.ok(domain.getProfile(userId, profile.id)!.config.proxyGroups[0].proxies.includes("🇦🇺 自定义名称"));
  assert.ok(other.id);
});

test("备份恢复保留同步绑定和别名，恢复的公开链接默认撤销", async () => {
  const { exportUserBackup, restoreUserBackup } = await import("../server/backup");
  const backup = exportUserBackup(userId, "test");
  const restoredUser = randomUUID();
  db.prepare("INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)").run(restoredUser, restoredUser, "hash", stamp);
  restoreUserBackup(restoredUser, backup, "merge");
  const profile = domain.listProfiles(restoredUser)[0];
  assert.equal(profile.autoUpdate, true);
  assert.equal(profile.includeNewNodes, true);
  assert.ok(profile.projectId && profile.projectId !== projectId);
  assert.ok(db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(profile.projectId!, restoredUser));
  assert.ok(domain.listPublishedSubscriptions(restoredUser).every((item) => item.revoked));
  const restoredNode = domain.listManagedNodes(restoredUser).find((item) => item.name === "🇦🇺 自定义名称")!;
  const metadata = db.prepare("SELECT original_name, name_override FROM managed_nodes WHERE id = ?").get(restoredNode.id) as { original_name: string; name_override: number };
  assert.equal(metadata.original_name, "节点一");
  assert.equal(metadata.name_override, 1);
});
