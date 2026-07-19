import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicAddress, safeFetchText } from "../server/safeFetch";

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
