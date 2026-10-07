import assert from "node:assert/strict";
import test from "node:test";
import { sourceErrorAdvice, subscriptionStatus } from "../src/shared/subscriptionStatus";
import type { GeneratedSubscription, GenerationProfile, NodeSource } from "../src/shared/domain";

const item = { revoked: false, updatedAt: "2026-01-01T00:00:00Z" } as GeneratedSubscription;
const profile = { sourceIds: ["source"], autoUpdate: true } as GenerationProfile;

test("订阅可获取不代表节点实测成功；撤销与过期优先于同步错误", () => {
  assert.match(subscriptionStatus(item, profile, []).detail, /实测/);
  const failed = { ...profile, lastSyncError: "内核校验失败" };
  assert.equal(subscriptionStatus(item, failed, []).available, true);
  assert.equal(subscriptionStatus({ ...item, revoked: true }, failed, []).available, false);
  assert.equal(subscriptionStatus({ ...item, expiresAt: "2020-01-01T00:00:00Z" }, profile, []).label, "链接已过期");
});

test("只关联本订阅的来源错误，且保留上次发布提示", () => {
  const source = { id: "source", lastError: "HTTP 404" } as NodeSource;
  assert.equal(subscriptionStatus(item, profile, [source]).label, "来源更新失败");
  assert.match(subscriptionStatus(item, profile, [source]).detail, /保留/);
  assert.equal(subscriptionStatus(item, profile, [{ ...source, id: "other" }]).tone, "success");
  assert.equal(subscriptionStatus(item, undefined, []).label, "方案已删除");
});

test("错误建议覆盖 404、权限、DNS、TLS、HTML、超时且不回显敏感地址", () => {
  for (const [error, expected] of [["HTTP 404", "IP"], ["403", "权限"], ["ENOTFOUND", "DNS"], ["TLS", "证书"], ["HTML", "网页"], ["timeout", "网络"], ["局域网", "公开"]]) {
    const advice = sourceErrorAdvice(`${error} https://example.com/private-token`);
    assert.ok(advice.includes(expected));
    assert.doesNotMatch(advice, /private-token/);
  }
});
