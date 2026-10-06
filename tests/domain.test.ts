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
