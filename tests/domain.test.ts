import assert from "node:assert/strict";
import test from "node:test";
import type { MihomoConfig } from "../src/shared/types";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

process.env.DATA_DIR = mkdtempSync(path.join(os.tmpdir(), "ou-yaml-domain-test-"));
const { db } = await import("../server/db");
const domain = await import("../server/domainService");

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

test("迁移旧项目节点到独立节点池并保持用户隔离", () => {
  assert.equal(domain.migrateLegacyProjects(userId), 1);
  assert.equal(domain.migrateLegacyProjects(userId), 0);
  const sources = domain.listNodeSources(userId);
  const nodes = domain.listManagedNodes(userId);
  assert.equal(sources.length, 1);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, "香港线路");
  assert.equal(domain.listManagedNodes(randomUUID()).length, 0);
});

test("生成配置发布后可读取并支持撤销", () => {
  const profile = domain.createProfile(userId, { name: "发布配置", targetFormat: "mihomo", config, nodeIds: ["legacy-node"] });
  assert.ok(profile);
  const published = domain.publishSubscription(userId, profile!.id, "测试订阅", "mihomo", "mixed-port: 7890\n", 1);
  assert.ok(published.token);
  assert.equal(domain.readPublicSubscription(published.id)?.content, "mixed-port: 7890\n");
  assert.equal(domain.revokePublishedSubscription(userId, published.id), true);
  assert.equal(domain.readPublicSubscription(published.id), undefined);
});

test("过期订阅不可访问", () => {
  const profile = domain.listProfiles(userId)[0];
  const published = domain.publishSubscription(userId, profile.id, "过期订阅", "mihomo", "rules: []\n", 0, new Date(Date.now() - 1000).toISOString());
  assert.equal(domain.readPublicSubscription(published.id), undefined);
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
  const result = domain.replaceManagedNodesForSource(userId, source.id, [
    { id: randomUUID(), name: "更新二", type: "vless", server: "two.example.com", port: 443, uuid: "two", extra: {} },
    { id: randomUUID(), name: "新节点", type: "vless", server: "three.example.com", port: 443, uuid: "three", extra: {} },
  ]);
  assert.deepEqual(result.nodes.map((node) => node.name), ["更新二", "新节点"]);
  assert.equal(result.nodes[0].id, second.id);
  assert.equal(result.nodes[0].tags.length, 0);
  assert.equal(result.source.nodeCount, 2);
});
