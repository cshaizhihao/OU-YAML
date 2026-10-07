import assert from "node:assert/strict";
import { test } from "node:test";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { decodeSubscriptionBody, isPublicAddress, safeFetchText, subscriptionRequestProfiles } from "../server/safeFetch";

test("订阅抓取优先使用机场常见的 clash-meta User-Agent", () => {
  assert.equal(subscriptionRequestProfiles[0].userAgent, "clash-meta/2.4.0");
  assert.ok(subscriptionRequestProfiles.some((profile) => /ClashMetaForAndroid/i.test(profile.userAgent)));
});

test("只允许公网单播地址", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "192.0.2.1"]) assert.equal(isPublicAddress(address), false, address);
});

test("订阅抓取拒绝本机和非 HTTP 协议", async () => {
  await assert.rejects(() => safeFetchText("http://127.0.0.1:8080/sub"), /非公网|本机|局域网/);
  await assert.rejects(() => safeFetchText("file:///etc/passwd"), /HTTP/);
  await assert.rejects(() => safeFetchText("http://169.254.169.254/latest/meta-data"), /非公网/);
});

test("订阅响应支持常见压缩格式并限制解压后大小", () => {
  const source = "vless://uuid@example.com:443#测试";
  assert.equal(decodeSubscriptionBody(gzipSync(source), "gzip", 1024), source);
  assert.equal(decodeSubscriptionBody(deflateSync(source), "deflate", 1024), source);
  assert.equal(decodeSubscriptionBody(brotliCompressSync(source), "br", 1024), source);
  assert.throws(() => decodeSubscriptionBody(gzipSync(source), "gzip", 4), /大小限制/);
});
